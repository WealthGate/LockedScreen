import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

import { BrowserWindow, clipboard, session as electronSession, type Input, type WebContents } from "electron";

import type { ExamConfigPackage, NavigationGuard, SessionStartRequest } from "@lockedscreen/shared-types";

const hostedPartition = "persist:lockedscreen-link";

export interface ActiveSessionState {
  examId: string;
  packageId: string;
  mode: SessionStartRequest["mode"];
  startedAt: string;
}

type SecurityEventRecorder = (category: string, severity: string, message: string, details?: string) => Promise<void>;

let activeSession: ActiveSessionState | null = null;
let activePackage: ExamConfigPackage | null = null;
let navigationGuard: NavigationGuard | null = null;

export const getActiveSession = (): ActiveSessionState | null => activeSession;
export const getActivePackage = (): ExamConfigPackage | null => activePackage;

export const setNavigationGuard = (guard: NavigationGuard | null): void => {
  navigationGuard = guard;
};

export const urlAllowedByGuard = (targetUrl: string): boolean => {
  if (!navigationGuard) {
    return false;
  }

  try {
    const target = new URL(targetUrl);
    const domainAllowed = navigationGuard.allowedDomains.some(
      (domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`)
    );
    const prefixAllowed = navigationGuard.allowedPrefixes?.some((prefix) => targetUrl.startsWith(prefix)) ?? false;
    return domainAllowed || prefixAllowed;
  } catch {
    return false;
  }
};

export const configureHostedPartition = (recordSecurityEvent: SecurityEventRecorder): void => {
  const targetSession = electronSession.fromPartition(hostedPartition);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  targetSession.on("will-download", (event) => {
    event.preventDefault();
    void recordSecurityEvent("navigation", "warning", "Blocked hosted-exam download attempt.");
  });
};

export const clearHostedPartitionData = async (): Promise<void> => {
  const targetSession = electronSession.fromPartition(hostedPartition);
  await targetSession.clearStorageData();
  await targetSession.clearCache();
};

const activeShortcutBlocked = (input: Input): boolean => {
  const lowerKey = input.key.toLowerCase();
  if (input.key === "F5") {
    return true;
  }

  if (input.control && ["r", "w", "n", "p", "l"].includes(lowerKey)) {
    return true;
  }

  if (input.alt && ["left", "right"].includes(lowerKey)) {
    return true;
  }

  if (activePackage?.clipboardPolicy.mode !== "allow" && input.control && ["c", "x", "v"].includes(lowerKey)) {
    return true;
  }

  return false;
};

export const configureWebContents = (contents: WebContents, recordSecurityEvent: SecurityEventRecorder): void => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("before-input-event", (event, input) => {
    if (!activeSession) {
      return;
    }

    if (activeShortcutBlocked(input)) {
      event.preventDefault();
    }
  });

  contents.on("context-menu", (event) => {
    if (activePackage && !activePackage.browserPolicy.allowContextMenu) {
      event.preventDefault();
    }
  });

  if (contents.getType() === "webview") {
    contents.on("will-navigate", (event, url) => {
      if (!urlAllowedByGuard(url)) {
        event.preventDefault();
        void recordSecurityEvent("navigation", "warning", "Blocked navigation to an unapproved URL.", url);
      }
    });
  }
};

const applyWindowState = async (browserWindow: BrowserWindow | null, configPackage: ExamConfigPackage | null): Promise<void> => {
  if (!browserWindow) {
    return;
  }

  const enabled = Boolean(configPackage);
  browserWindow.setAlwaysOnTop(enabled, "screen-saver");
  browserWindow.setFullScreen(enabled);
  if (configPackage?.clipboardPolicy.mode !== "allow") {
    clipboard.clear();
  }
};

export const beginManagedSession = async (
  browserWindow: BrowserWindow | null,
  request: SessionStartRequest,
  configPackage: ExamConfigPackage,
  recordSecurityEvent: SecurityEventRecorder
): Promise<void> => {
  activeSession = {
    examId: request.examId,
    packageId: request.packageId,
    mode: request.mode,
    startedAt: new Date().toISOString()
  };
  activePackage = configPackage;

  if (configPackage.sessionPolicy.clearSessionOnStart && request.mode === "link") {
    await clearHostedPartitionData();
  }

  await applyWindowState(browserWindow, configPackage);
  await recordSecurityEvent(
    "session",
    "info",
    `Started ${configPackage.securityMode} session for "${configPackage.label}".`,
    `Exam ${request.examId}`
  );
};

export const endManagedSession = async (
  browserWindow: BrowserWindow | null,
  reason: string,
  recordSecurityEvent: SecurityEventRecorder
): Promise<void> => {
  if (activePackage?.sessionPolicy.clearSessionOnEnd && activeSession?.mode === "link") {
    await clearHostedPartitionData();
  }

  activeSession = null;
  activePackage = null;
  navigationGuard = null;
  await applyWindowState(browserWindow, null);
  await recordSecurityEvent("session", "info", "Ended managed session.", reason);
};

export const launchApprovedApplication = async (
  configPackage: ExamConfigPackage,
  appId: string,
  recordSecurityEvent: SecurityEventRecorder
): Promise<void> => {
  const approvedApp = configPackage.allowedApplications.find((candidate) => candidate.id === appId);
  if (!approvedApp) {
    throw new Error("Approved application not found for the selected package.");
  }

  if (!existsSync(approvedApp.executablePath)) {
    throw new Error("Approved application executable path does not exist.");
  }

  const child = spawn(approvedApp.executablePath, approvedApp.args, {
    windowsHide: true,
    stdio: "ignore"
  });

  child.on("exit", (code) => {
    void recordSecurityEvent(
      "application",
      "info",
      `Approved application "${approvedApp.label}" exited.`,
      `Exit code ${code ?? 0}`
    );
  });

  await recordSecurityEvent(
    "application",
    "info",
    `Launched approved application "${approvedApp.label}".`,
    approvedApp.executablePath
  );
};
