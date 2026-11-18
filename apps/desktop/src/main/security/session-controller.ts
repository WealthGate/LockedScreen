import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

import { BrowserWindow, clipboard, session as electronSession, type Input, type WebContents } from "electron";

import type { ExamConfigPackage, NavigationGuard, SessionStartRequest } from "@lockedscreen/shared-types";
import { isSameSession } from "./session-policy";

const hostedPartition = "persist:lockedscreen-link";

export interface ActiveSessionState {
  examId: string;
  packageId: string;
  mode: SessionStartRequest["mode"];
  startedAt: string;
  securityHold?: string;
}

type SecurityEventRecorder = (category: string, severity: string, message: string, details?: string) => Promise<void>;

let activeSession: ActiveSessionState | null = null;
let activePackage: ExamConfigPackage | null = null;
let navigationGuard: NavigationGuard | null = null;
let exitCleanupPending = false;

const isHostedGoogleFormsUrl = (target: URL): boolean => {
  if (target.hostname === "forms.gle" || target.hostname === "forms.google.com") {
    return true;
  }

  return target.hostname === "docs.google.com" && target.pathname.includes("/forms/");
};

const isHostedGoogleFormsScoreUrl = (target: URL): boolean => {
  if (target.hostname !== "docs.google.com" || !target.pathname.includes("/forms/")) {
    return false;
  }

  return (
    target.pathname.includes("/viewscore") ||
    target.pathname.includes("/viewanalytics") ||
    target.searchParams.has("viewscore") ||
    target.searchParams.has("score") ||
    target.search.includes("viewscore")
  );
};

const isEmbeddedGoogleAccountSignInUrl = (target: URL): boolean => {
  if (target.hostname !== "accounts.google.com") {
    return false;
  }

  return (
    target.pathname.includes("/signin") ||
    target.pathname.includes("/ServiceLogin") ||
    target.pathname.includes("/InteractiveLogin") ||
    target.pathname.includes("/o/oauth2") ||
    target.searchParams.has("continue")
  );
};

const notifyEmbeddedGoogleSignInBlocked = (url: string): void => {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.webContents.send("session:embeddedGoogleSignInBlocked", { url });
  }
};

export const getActiveSession = (): ActiveSessionState | null => activeSession;
export const getActivePackage = (): ExamConfigPackage | null => activePackage;
export const holdManagedSession = (message: string): void => {
  if (activeSession) activeSession.securityHold = message;
};

export const setNavigationGuard = (guard: NavigationGuard | null): void => {
  if (activeSession) throw new Error("Navigation policy cannot be changed during an active exam.");
  navigationGuard = guard;
};

const matchesUrlPrefix = (target: URL, prefix: string): boolean => {
  try {
    const allowed = new URL(prefix);
    if (allowed.protocol !== "https:" || target.origin !== allowed.origin) return false;
    const path = allowed.pathname;
    if (target.pathname !== path && !target.pathname.startsWith(path.endsWith("/") ? path : `${path}/`)) return false;
    return [...allowed.searchParams].every(([name, value]) => target.searchParams.getAll(name).includes(value));
  } catch { return false; }
};

const urlAllowedByPolicy = (guard: NavigationGuard | null, targetUrl: string): boolean => {
  if (!guard) {
    return false;
  }

  try {
    const target = new URL(targetUrl);
    if (target.protocol !== "https:" || target.username || target.password) return false;
    const domainAllowed = guard.allowedDomains.some(
      (domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`)
    );
    // Google account sign-in is intentionally not allowed inside the embedded exam browser.
    // Google blocks embedded OAuth/user-agent sign-in, and opening a normal browser during
    // a locked exam would weaken the secure session.
    if (guard.mode === "link" && isEmbeddedGoogleAccountSignInUrl(target)) {
      return false;
    }

    // Asset requests do not need a top-level navigation exception. Never grant general
    // Google Search/account/storage browsing just to load Forms fonts or scripts.
    // Google Forms posts the final response to docs.google.com/forms/.../formResponse, then may open
    // docs.google.com/forms/.../viewscore so students can see grades released by the teacher.
    // Both routes stay inside Google Forms and are allowed without opening the unrestricted browser.
    const googleFormsAllowed = guard.mode === "link" && isHostedGoogleFormsUrl(target);
    const googleFormsScoreAllowed = guard.mode === "link" && isHostedGoogleFormsScoreUrl(target);
    const prefixAllowed = guard.allowedPrefixes?.some((prefix) => matchesUrlPrefix(target, prefix)) ?? false;
    return domainAllowed || googleFormsAllowed || googleFormsScoreAllowed || prefixAllowed;
  } catch {
    return false;
  }
};

export const urlAllowedByGuard = (targetUrl: string): boolean => urlAllowedByPolicy(navigationGuard, targetUrl);

const packageNavigationGuard = (config: ExamConfigPackage, mode: SessionStartRequest["mode"]): NavigationGuard => ({
  mode, allowedDomains: config.browserPolicy.allowedDomains,
  allowedPrefixes: config.browserPolicy.urlRules.filter(rule => rule.kind === "prefix").map(rule => rule.pattern),
  startUrl: config.browserPolicy.startUrl
});

export const assertExamNavigation = (config: ExamConfigPackage, mode: SessionStartRequest["mode"]): void => {
  if (mode === "link" && !urlAllowedByPolicy(packageNavigationGuard(config, mode), config.browserPolicy.startUrl ?? "")) {
    throw new Error("The hosted exam start URL is not approved. Configure an HTTPS exam URL and its navigation policy before starting.");
  }
};

export const configureHostedPartition = (recordSecurityEvent: SecurityEventRecorder): void => {
  const targetSession = electronSession.fromPartition(hostedPartition);
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    // Covers redirects and programmatic webview.src/loadURL changes as well as user navigation.
    if (details.resourceType === "mainFrame" && (!activeSession || activeSession.securityHold || !urlAllowedByGuard(details.url))) {
      try {
        if (isEmbeddedGoogleAccountSignInUrl(new URL(details.url))) notifyEmbeddedGoogleSignInBlocked(details.url);
      } catch { /* Malformed URLs are denied by the same guard. */ }
      callback({ cancel: true });
      return;
    }
    callback({});
  });
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
  if (
    input.meta ||
    ["f5", "f11", "f12", "printscreen", "snapshot", "super", "meta", "os", "apps", "contextmenu"].includes(lowerKey)
  ) {
    return true;
  }

  if (
    input.control &&
    ["a", "c", "f", "i", "j", "l", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x"].includes(lowerKey)
  ) {
    return true;
  }

  if (input.control && input.shift && ["delete", "escape", "i", "j", "r"].includes(lowerKey)) {
    return true;
  }

  if (input.alt && ["escape", "f4", "left", "right", "arrowleft", "arrowright", "tab", " ", "space"].includes(lowerKey)) {
    return true;
  }

  if (activePackage?.clipboardPolicy.mode !== "allow" && input.control && ["c", "x", "v"].includes(lowerKey)) {
    return true;
  }

  return false;
};

export const configureWebContents = (contents: WebContents, recordSecurityEvent: SecurityEventRecorder): void => {
  contents.on("will-attach-webview", (event, preferences, params) => {
    if (!activeSession || activeSession.securityHold || !urlAllowedByGuard(params.src ?? "")) {
      event.preventDefault();
      return;
    }
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.devTools = false;
    preferences.webSecurity = true;
    preferences.allowRunningInsecureContent = false;
    preferences.webviewTag = false;
  });
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (activeSession?.mode === "link" && isEmbeddedGoogleAccountSignInUrl(target)) {
        notifyEmbeddedGoogleSignInBlocked(url);
        void recordSecurityEvent(
          "navigation",
          "warning",
          "Blocked Google sign-in inside the embedded exam browser.",
          "Google requires account sign-in to happen in a supported browser outside Electron webviews."
        );
        return { action: "deny" };
      }
    } catch {
      // Fall through to the normal guard for malformed popup URLs.
    }

    if (contents.getType() === "webview" && urlAllowedByGuard(url)) {
      // Keep approved popups inside the locked exam webview instead of opening a normal browser window.
      void contents.loadURL(url);
    } else {
      void recordSecurityEvent("navigation", "warning", "Blocked hosted-exam popup to an unapproved URL.", url);
    }

    return { action: "deny" };
  });
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
      try {
        const target = new URL(url);
        if (activeSession?.mode === "link" && isEmbeddedGoogleAccountSignInUrl(target)) {
          event.preventDefault();
          notifyEmbeddedGoogleSignInBlocked(url);
          void recordSecurityEvent(
            "navigation",
            "warning",
            "Blocked Google sign-in inside the embedded exam browser.",
            "Google requires account sign-in to happen in a supported browser outside Electron webviews."
          );
          return;
        }
      } catch {
        // Fall through to the normal guard for malformed navigation URLs.
      }

      if (!urlAllowedByGuard(url)) {
        event.preventDefault();
        void recordSecurityEvent("navigation", "warning", "Blocked navigation to an unapproved URL.", url);
      }
    });
  }
};

let restoreWindow: (() => void) | null = null;

export const reinforceExamWindow = (browserWindow: BrowserWindow | null): void => {
  if (!activeSession || !browserWindow || browserWindow.isDestroyed()) return;
  if (browserWindow.isMinimized()) browserWindow.restore();
  if (!browserWindow.isKiosk()) browserWindow.setKiosk(true);
  browserWindow.setAlwaysOnTop(true, "screen-saver");
  browserWindow.show();
  browserWindow.focus();
};

const applyWindowState = async (browserWindow: BrowserWindow | null, configPackage: ExamConfigPackage | null): Promise<void> => {
  if (!browserWindow) {
    return;
  }

  const enabled = Boolean(configPackage);
  if (enabled && !restoreWindow) {
    const previous = {
      kiosk: browserWindow.isKiosk(), fullscreen: browserWindow.isFullScreen(),
      top: browserWindow.isAlwaysOnTop(), resizable: browserWindow.isResizable(),
      minimizable: browserWindow.isMinimizable(), movable: browserWindow.isMovable(),
      maximizable: browserWindow.isMaximizable()
    };
    browserWindow.setResizable(false);
    browserWindow.setMinimizable(false);
    browserWindow.setMaximizable(false);
    browserWindow.setMovable(false);
    browserWindow.setContentProtection(true);
    const recover = () => reinforceExamWindow(browserWindow);
    browserWindow.on("blur", recover);
    browserWindow.on("minimize", recover);
    browserWindow.on("leave-full-screen", recover);
    const timer = setInterval(() => {
      if (!browserWindow.isDestroyed() && (!browserWindow.isFocused() || !browserWindow.isKiosk() || browserWindow.isMinimized())) recover();
    }, 500);
    restoreWindow = () => {
      clearInterval(timer);
      browserWindow.removeListener("blur", recover);
      browserWindow.removeListener("minimize", recover);
      browserWindow.removeListener("leave-full-screen", recover);
      if (browserWindow.isDestroyed()) return;
      browserWindow.setKiosk(previous.kiosk);
      browserWindow.setFullScreen(previous.fullscreen);
      browserWindow.setAlwaysOnTop(previous.top, "screen-saver");
      browserWindow.setResizable(previous.resizable);
      browserWindow.setMinimizable(previous.minimizable);
      browserWindow.setMaximizable(previous.maximizable);
      browserWindow.setMovable(previous.movable);
      browserWindow.setContentProtection(false);
    };
  }
  if (!enabled) {
    restoreWindow?.();
    restoreWindow = null;
    return;
  }
  browserWindow.setKiosk(true);
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
  if (activeSession) {
    if (isSameSession(activeSession, request)) return;
    throw new Error("Release the current exam with the invigilator PIN before starting another exam.");
  }
  if (exitCleanupPending) {
    throw new Error("Previous exam browser cleanup is still running. Wait for it to finish or restart the app before starting another exam.");
  }
  assertExamNavigation(configPackage, request.mode);
  if (configPackage.sessionPolicy.clearSessionOnStart && request.mode === "link") {
    await clearHostedPartitionData();
  }
  activeSession = {
    examId: request.examId,
    packageId: request.packageId,
    mode: request.mode,
    startedAt: new Date().toISOString()
  };
  activePackage = configPackage;
  navigationGuard = packageNavigationGuard(configPackage, request.mode);
  try {
    await applyWindowState(browserWindow, configPackage);
  } catch (error) {
    activeSession = null;
    activePackage = null;
    navigationGuard = null;
    await applyWindowState(browserWindow, null);
    throw error;
  }
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
  const clearHostedData = activePackage?.sessionPolicy.clearSessionOnEnd && activeSession?.mode === "link";
  activeSession = null;
  activePackage = null;
  navigationGuard = null;
  await applyWindowState(browserWindow, null);

  // Browser cleanup and audit storage must not prevent native lockdown release.
  if (clearHostedData) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    exitCleanupPending = true;
    try {
      await Promise.race([
        clearHostedPartitionData().finally(() => { exitCleanupPending = false; }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Hosted session cleanup timed out.")), 3000);
        })
      ]);
    } catch (error) {
      console.warn("Hosted session cleanup did not complete during exit.", error);
    } finally {
      clearTimeout(timer);
    }
  }

  void recordSecurityEvent("session", "info", "Ended managed session.", reason).catch((error) => {
    console.warn("Could not record managed session exit.", error);
  });
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
