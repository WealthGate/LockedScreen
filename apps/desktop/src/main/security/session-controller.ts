import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

import { BrowserWindow, clipboard, screen, session as electronSession, type Input, type WebContents } from "electron";

import type { ExamConfigPackage, NavigationGuard, SessionStartRequest, HostedWebsiteAuthState } from "@lockedscreen/shared-types";
import { isSameSession } from "./session-policy";
import { createWebsiteSignInPolicy, isWebsiteIdentityUrl } from "./website-sign-in";

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
let websiteSignIn: ReturnType<typeof createWebsiteSignInPolicy> | null = null;
let websiteAuthState: HostedWebsiteAuthState = "exam";
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

const notifyWebsiteAuth = (state: HostedWebsiteAuthState): void => {
  if (websiteAuthState === state) return;
  websiteAuthState = state;
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.webContents.send("session:websiteAuthState", state);
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

const urlAllowedByPolicy = (guard: NavigationGuard | null, targetUrl: string, auth = websiteSignIn): boolean => {
  if (!guard) {
    return false;
  }

  try {
    const target = new URL(targetUrl);
    if (target.protocol !== "https:" || target.username || target.password) return false;
    const domainAllowed = guard.allowedDomains.some(
      (domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`)
    );
    if (isWebsiteIdentityUrl(target)) return activeSession?.mode === "link" && Boolean(auth?.allows(target));
    const scopedForm = auth?.formNavigationAllowed(target);
    if (scopedForm !== undefined) return scopedForm;

    // Asset requests do not need a top-level navigation exception. Never grant general
    // Google Search/account/storage browsing just to load Forms fonts or scripts.
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
    if (details.resourceType === "mainFrame") {
      if (!activeSession || activeSession.securityHold || !urlAllowedByGuard(details.url)) {
        if (activeSession?.mode === "link") notifyWebsiteAuth("blocked");
        callback({ cancel: true });
        return;
      }
      const state = websiteSignIn?.observe(details.url);
      if (state) notifyWebsiteAuth(state);
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
    preferences.partition = hostedPartition;
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
    if (contents.getType() === "webview" && urlAllowedByGuard(url)) {
      // Keep approved popups inside the locked exam webview instead of opening a normal browser window.
      void contents.loadURL(url).catch(() => notifyWebsiteAuth("blocked"));
    } else {
      void recordSecurityEvent("navigation", "warning", "Blocked hosted-exam popup to an unapproved URL.");
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
    contents.on("did-navigate", (_event, url) => {
      if (!activeSession || activeSession.securityHold) return;
      const state = websiteSignIn?.observe(url);
      if (state) notifyWebsiteAuth(state);
    });
    contents.on("will-navigate", (event, url) => {
      if (!activeSession || activeSession.securityHold || !urlAllowedByGuard(url)) {
        event.preventDefault();
        notifyWebsiteAuth("blocked");
        void recordSecurityEvent("navigation", "warning", "Blocked navigation outside the approved exam/sign-in policy.");
      }
    });
  }
};

let restoreWindow: (() => Promise<void>) | null = null;
let reinforcingWindow = false;

export const isExamWindowFullscreen = (browserWindow: BrowserWindow): boolean => {
  if (browserWindow.isDestroyed() || browserWindow.isMinimized() || !browserWindow.isKiosk() || !browserWindow.isFullScreen()) return false;
  const display = screen.getDisplayMatching(browserWindow.getBounds()).bounds;
  const coversDisplay = (bounds: Electron.Rectangle): boolean =>
    (["x", "y", "width", "height"] as const).every(key => Math.abs(bounds[key] - display[key]) <= 1);
  return coversDisplay(browserWindow.getBounds()) && coversDisplay(browserWindow.getContentBounds());
};

export const reinforceExamWindow = (browserWindow: BrowserWindow | null): boolean => {
  if (!activeSession || !browserWindow || browserWindow.isDestroyed()) return false;
  if (reinforcingWindow) return isExamWindowFullscreen(browserWindow);
  reinforcingWindow = true;
  try {
    if (browserWindow.isMinimized()) browserWindow.restore();
    if (!isExamWindowFullscreen(browserWindow)) {
      // On Windows, disabling resize pins min/max to the current size. Unpin
      // before entering or repairing fullscreen, then restrict the full-size window.
      browserWindow.setResizable(true);
      browserWindow.setMaximizable(true);
      browserWindow.setFullScreenable(true);
      browserWindow.setMinimumSize(0, 0);
      browserWindow.setMaximumSize(0, 0);
      browserWindow.setBounds(screen.getDisplayMatching(browserWindow.getBounds()).bounds, false);
      browserWindow.setKiosk(true);
      if (!browserWindow.isFullScreen()) browserWindow.setFullScreen(true);
    }
    if (isExamWindowFullscreen(browserWindow)) {
      browserWindow.setResizable(false);
      browserWindow.setMaximizable(false);
    }
    browserWindow.setAlwaysOnTop(true, "screen-saver");
    browserWindow.show();
    browserWindow.focus();
    return isExamWindowFullscreen(browserWindow);
  } finally { reinforcingWindow = false; }
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
      maximizable: browserWindow.isMaximizable(), fullscreenable: browserWindow.isFullScreenable(),
      bounds: browserWindow.getBounds(), minimum: browserWindow.getMinimumSize(),
      maximum: browserWindow.getMaximumSize(), maximized: browserWindow.isMaximized()
    };
    browserWindow.setMinimizable(false);
    browserWindow.setMovable(false);
    browserWindow.setContentProtection(true);
    let timer: ReturnType<typeof setInterval> | undefined;
    const recover = () => {
      if (!activeSession || reinforcingWindow || browserWindow.isDestroyed()) return;
      try {
        if (reinforceExamWindow(browserWindow)) return;
      } catch { /* The exam is held below if full display coverage cannot be recovered. */ }
      const reason = "Fullscreen protection could not be restored. Ask the invigilator to release this exam.";
      holdManagedSession(reason);
      browserWindow.webContents.send("session:securityHold", { reason });
    };
    restoreWindow = async () => {
      clearInterval(timer);
      browserWindow.removeListener("blur", recover);
      browserWindow.removeListener("minimize", recover);
      browserWindow.removeListener("leave-full-screen", recover);
      browserWindow.removeListener("resize", recover);
      browserWindow.removeListener("move", recover);
      if (browserWindow.isDestroyed()) return;
      // Release fullscreen-size constraints before restoring the normal window.
      browserWindow.setResizable(true);
      browserWindow.setFullScreenable(true);
      browserWindow.setMinimumSize(0, 0);
      browserWindow.setMaximumSize(0, 0);
      browserWindow.setKiosk(previous.kiosk);
      if (browserWindow.isFullScreen() !== previous.fullscreen) browserWindow.setFullScreen(previous.fullscreen);
      browserWindow.setMovable(true);
      browserWindow.setMaximizable(true);
      if (!previous.kiosk && !previous.fullscreen) {
        browserWindow.restore();
        if (previous.maximized) {
          browserWindow.setMaximizable(true);
          browserWindow.maximize();
        } else {
          // Chromium can finish the Windows fullscreen transition on a later turn.
          const deadline = Date.now() + 500;
          do {
            browserWindow.setBounds(previous.bounds, false);
            if ((["x", "y", "width", "height"] as const).every(key => Math.abs(browserWindow.getBounds()[key] - previous.bounds[key]) <= 1)) break;
            await new Promise(resolve => setTimeout(resolve, 25));
          } while (!browserWindow.isDestroyed() && Date.now() < deadline);
          if (browserWindow.isDestroyed()) return;
        }
      }
      browserWindow.setAlwaysOnTop(previous.top, "screen-saver");
      browserWindow.setResizable(previous.resizable);
      browserWindow.setMinimumSize(previous.minimum[0] ?? 0, previous.minimum[1] ?? 0);
      browserWindow.setMaximumSize(previous.maximum[0] ?? 0, previous.maximum[1] ?? 0);
      browserWindow.setMinimizable(previous.minimizable);
      browserWindow.setMaximizable(previous.maximizable);
      browserWindow.setMovable(previous.movable);
      browserWindow.setFullScreenable(previous.fullscreenable);
      browserWindow.setContentProtection(false);
    };
    const deadline = Date.now() + 2000;
    while (!reinforceExamWindow(browserWindow)) {
      if (Date.now() >= deadline) throw new Error("Fullscreen could not be confirmed. The exam has not started.");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    browserWindow.on("blur", recover);
    browserWindow.on("minimize", recover);
    browserWindow.on("leave-full-screen", recover);
    browserWindow.on("resize", recover);
    browserWindow.on("move", recover);
    timer = setInterval(() => {
      if (!browserWindow.isDestroyed() && (!browserWindow.isFocused() || !isExamWindowFullscreen(browserWindow))) recover();
    }, 500);
  }
  if (!enabled) {
    await restoreWindow?.();
    restoreWindow = null;
    return;
  }
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
  websiteSignIn = request.mode === "link" ? createWebsiteSignInPolicy(navigationGuard) : null;
  websiteAuthState = "exam";
  try {
    await applyWindowState(browserWindow, configPackage);
  } catch (error) {
    activeSession = null;
    activePackage = null;
    navigationGuard = null;
    websiteSignIn = null;
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
  websiteSignIn = null;
  websiteAuthState = "exam";
  exitCleanupPending = true;
  try { await applyWindowState(browserWindow, null); }
  finally { exitCleanupPending = false; }

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
