import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

import { BrowserWindow, clipboard, session as electronSession, type Input, type WebContents } from "electron";

import type { ExamConfigPackage, NavigationGuard, SessionStartRequest } from "@lockedscreen/shared-types";

const hostedPartition = "persist:lockedscreen-link";
const hostedBrowserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

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
let hostedGoogleSignInWindow: BrowserWindow | null = null;

const hostedAuthDomains = [
  "accounts.google.com",
  "accounts.youtube.com",
  "myaccount.google.com",
  "www.google.com",
  "oauth2.googleapis.com",
  "apis.google.com",
  "content.googleapis.com",
  "ssl.gstatic.com",
  "www.gstatic.com",
  "fonts.gstatic.com",
  "fonts.googleapis.com",
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
  "ogs.google.com",
  "googleusercontent.com"
];

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
  // Google Forms sign-in must remain inside the locked exam browser so students
  // can continue the form after authentication. The navigation guard allows only
  // trusted Google auth/support domains; normal browser windows are still denied.
  return false;
};

const notifyHostedGoogleSignInStarted = (url: string): void => {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.webContents.send("session:hostedGoogleSignInStarted", { url });
  }
};

const notifyHostedGoogleSignInFinished = (status: "completed" | "cancelled", url?: string): void => {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.webContents.send("session:hostedGoogleSignInFinished", { status, url });
  }
};

const urlAllowedInHostedGoogleSignIn = (targetUrl: string): boolean => {
  try {
    const target = new URL(targetUrl);
    const googleSupportAllowed = hostedAuthDomains.some(
      (domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`)
    );
    return googleSupportAllowed || isHostedGoogleFormsUrl(target) || isHostedGoogleFormsScoreUrl(target);
  } catch {
    return false;
  }
};

const openHostedGoogleSignInWindow = async (
  url: string,
  recordSecurityEvent: SecurityEventRecorder
): Promise<void> => {
  if (hostedGoogleSignInWindow && !hostedGoogleSignInWindow.isDestroyed()) {
    hostedGoogleSignInWindow.focus();
    return;
  }

  const parentWindow = BrowserWindow.getAllWindows()[0] ?? null;
  let completed = false;

  hostedGoogleSignInWindow = new BrowserWindow({
    width: 1040,
    height: 820,
    minWidth: 900,
    minHeight: 700,
    parent: parentWindow ?? undefined,
    modal: Boolean(parentWindow),
    title: "Google sign-in",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      partition: hostedPartition
    }
  });

  hostedGoogleSignInWindow.webContents.setUserAgent(hostedBrowserUserAgent);
  hostedGoogleSignInWindow.setMenu(null);
  notifyHostedGoogleSignInStarted(url);

  const finishIfReturnedToForm = (targetUrl: string): void => {
    try {
      const target = new URL(targetUrl);
      if (isHostedGoogleFormsUrl(target)) {
        completed = true;
        notifyHostedGoogleSignInFinished("completed", targetUrl);
        hostedGoogleSignInWindow?.close();
      }
    } catch {
      // Ignore malformed URLs; the navigation guard will handle them.
    }
  };

  hostedGoogleSignInWindow.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    if (urlAllowedInHostedGoogleSignIn(popupUrl)) {
      void hostedGoogleSignInWindow?.loadURL(popupUrl);
    } else {
      void recordSecurityEvent("navigation", "warning", "Blocked Google sign-in popup to an unapproved URL.", popupUrl);
    }
    return { action: "deny" };
  });

  hostedGoogleSignInWindow.webContents.on("before-input-event", (event, input) => {
    if (activeShortcutBlocked(input)) {
      event.preventDefault();
    }
  });

  hostedGoogleSignInWindow.webContents.on("context-menu", (event) => {
    event.preventDefault();
  });

  hostedGoogleSignInWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!urlAllowedInHostedGoogleSignIn(targetUrl)) {
      event.preventDefault();
      void recordSecurityEvent("navigation", "warning", "Blocked Google sign-in navigation to an unapproved URL.", targetUrl);
    }
  });

  hostedGoogleSignInWindow.webContents.on("did-navigate", (_event, targetUrl) => {
    finishIfReturnedToForm(targetUrl);
  });

  hostedGoogleSignInWindow.webContents.on("did-navigate-in-page", (_event, targetUrl) => {
    finishIfReturnedToForm(targetUrl);
  });

  hostedGoogleSignInWindow.on("closed", () => {
    hostedGoogleSignInWindow = null;
    if (!completed) {
      notifyHostedGoogleSignInFinished("cancelled");
    }
  });

  await recordSecurityEvent(
    "navigation",
    "info",
    "Opened controlled Google sign-in window for hosted exam.",
    "The window shares the locked exam browser session and stays inside the app."
  );
  await hostedGoogleSignInWindow.loadURL(url);
};

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
    // Google account sign-in is allowed only through the locked exam browser and
    // trusted Google support domains. This mirrors secure-browser behavior while
    // preventing unrestricted external browser navigation.
    if (navigationGuard.mode === "link" && isEmbeddedGoogleAccountSignInUrl(target)) {
      return false;
    }

    // Trusted Google support domains are allowed for Forms assets and post-submit score pages,
    // but not for account sign-in screens.
    const googleAuthAllowed =
      navigationGuard.mode === "link" &&
      hostedAuthDomains.some((domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`));
    // Google Forms posts the final response to docs.google.com/forms/.../formResponse, then may open
    // docs.google.com/forms/.../viewscore so students can see grades released by the teacher.
    // Both routes stay inside Google Forms and are allowed without opening the unrestricted browser.
    const googleFormsAllowed = navigationGuard.mode === "link" && isHostedGoogleFormsUrl(target);
    const googleFormsScoreAllowed = navigationGuard.mode === "link" && isHostedGoogleFormsScoreUrl(target);
    const prefixAllowed = navigationGuard.allowedPrefixes?.some((prefix) => targetUrl.startsWith(prefix)) ?? false;
    return domainAllowed || googleAuthAllowed || googleFormsAllowed || googleFormsScoreAllowed || prefixAllowed;
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

  if (input.alt && ["escape", "f4", "left", "right", "tab"].includes(lowerKey)) {
    return true;
  }

  if (activePackage?.clipboardPolicy.mode !== "allow" && input.control && ["c", "x", "v"].includes(lowerKey)) {
    return true;
  }

  return false;
};

export const configureWebContents = (contents: WebContents, recordSecurityEvent: SecurityEventRecorder): void => {
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (activeSession?.mode === "link" && isEmbeddedGoogleAccountSignInUrl(target)) {
        void openHostedGoogleSignInWindow(url, recordSecurityEvent);
        void recordSecurityEvent(
          "navigation",
          "info",
          "Routed Google sign-in to the controlled hosted sign-in window.",
          "Google sign-in is kept inside Lockedscreen while avoiding the embedded webview."
        );
        return { action: "deny" };
      }
    } catch {
      // Fall through to the normal guard for malformed popup URLs.
    }

    if (urlAllowedByGuard(url)) {
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
          void openHostedGoogleSignInWindow(url, recordSecurityEvent);
          void recordSecurityEvent(
            "navigation",
            "info",
            "Routed Google sign-in to the controlled hosted sign-in window.",
            "Google sign-in is kept inside Lockedscreen while avoiding the embedded webview."
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

  hostedGoogleSignInWindow?.close();
  hostedGoogleSignInWindow = null;

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
