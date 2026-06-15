import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain, Notification } from "electron";
import updater from "electron-updater";

import type { AppUpdateState } from "@lockedscreen/shared-types";

const { autoUpdater } = updater;

const updateCacheFilePattern = /lockedscreen.*\.(exe|blockmap|yml)$/i;
const startupUpdateCheckDelayMs = 15000;
const periodicUpdateCheckIntervalMs = 30 * 60 * 1000;
const updateInstallHandoffDelayMs = 4000;
const pendingUpdateMarkerName = "pending-update-install.json";

let updateState: AppUpdateState = {
  status: "idle",
  currentVersion: app.getVersion()
};
let periodicUpdateCheckTimer: NodeJS.Timeout | null = null;
let updateInstallRequested = false;

const updateMainWindow = (window: BrowserWindow | null): void => {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send("app:updateStateChanged", updateState);
};

const setUpdateState = (window: BrowserWindow | null, next: Partial<AppUpdateState>): AppUpdateState => {
  updateState = {
    ...updateState,
    currentVersion: app.getVersion(),
    ...next
  };
  updateMainWindow(window);
  return updateState;
};

const showUpdateNotification = (window: BrowserWindow | null, title: string, body: string): void => {
  if (!app.isPackaged || !Notification.isSupported()) {
    return;
  }

  const notification = new Notification({ title, body });
  notification.on("click", () => {
    if (!window || window.isDestroyed()) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  });
  notification.show();
};

const pendingUpdateMarkerPath = (): string => join(app.getPath("userData"), pendingUpdateMarkerName);

const rememberPendingUpdate = async (targetVersion?: string): Promise<void> => {
  if (!targetVersion) {
    return;
  }

  await writeFile(
    pendingUpdateMarkerPath(),
    JSON.stringify({
      targetVersion,
      requestedAt: new Date().toISOString()
    }),
    "utf-8"
  );
};

const restoreCompletedUpdate = async (getMainWindow: () => BrowserWindow | null): Promise<void> => {
  const markerPath = pendingUpdateMarkerPath();
  const marker = await readFile(markerPath, "utf-8")
    .then((value) => JSON.parse(value) as { targetVersion?: unknown })
    .catch(() => null);

  if (!marker) {
    return;
  }

  await rm(markerPath, { force: true }).catch(() => undefined);
  if (typeof marker.targetVersion !== "string" || marker.targetVersion !== app.getVersion()) {
    return;
  }

  const window = getMainWindow();
  setUpdateState(window, {
    status: "installed",
    availableVersion: app.getVersion(),
    percent: 100,
    message: `Update complete. Lockedscreen ${app.getVersion()} is now installed and ready to use.`
  });
  showUpdateNotification(
    window,
    "Lockedscreen update complete",
    `Version ${app.getVersion()} is installed and ready to use.`
  );
};

const friendlyUpdateError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (!app.isPackaged) {
    return "Updates are available only in the installed app.";
  }

  if (message.toLowerCase().includes("latest.yml") || message.toLowerCase().includes("404")) {
    return "No update feed is published yet. Upload the new installer and latest.yml to the release location.";
  }

  return message || "Unable to check for updates right now.";
};

const cleanupOldUpdateFiles = async (): Promise<void> => {
  if (!app.isPackaged) {
    return;
  }

  const currentVersion = app.getVersion();
  const localAppData = process.env.LOCALAPPDATA;
  const candidateDirectories = [
    localAppData ? join(localAppData, "lockedscreen-updater") : "",
    localAppData ? join(localAppData, "Lockedscreen-updater") : "",
    join(app.getPath("userData"), "pending")
  ].filter(Boolean);

  for (const directory of candidateDirectories) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && updateCacheFilePattern.test(entry.name) && !entry.name.includes(currentVersion))
        .map((entry) => rm(join(directory, entry.name), { force: true }).catch(() => undefined))
    );
  }
};

interface ConfigureAppUpdatesOptions {
  onBeforeInstall?: () => void;
}

export const configureAppUpdates = (
  getMainWindow: () => BrowserWindow | null,
  options: ConfigureAppUpdatesOptions = {}
): void => {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;

  void restoreCompletedUpdate(getMainWindow);
  void cleanupOldUpdateFiles();

  autoUpdater.on("checking-for-update", () => {
    setUpdateState(getMainWindow(), {
      status: "checking",
      percent: undefined,
      message: "Checking for Lockedscreen updates..."
    });
  });

  autoUpdater.on("update-available", (info) => {
    const window = getMainWindow();
    setUpdateState(getMainWindow(), {
      status: "available",
      availableVersion: info.version,
      releaseName: info.releaseName ?? undefined,
      releaseDate: info.releaseDate,
      percent: undefined,
      message: `Lockedscreen ${info.version} is available. Download it when convenient; you choose when to install.`
    });
    showUpdateNotification(window, "Lockedscreen update available", `Version ${info.version} is ready to download.`);
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdateState(getMainWindow(), {
      status: "not-available",
      availableVersion: info.version,
      percent: undefined,
      message: "Lockedscreen is up to date."
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState(getMainWindow(), {
      status: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      message: `Downloading update: ${Math.round(progress.percent)}%`
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const window = getMainWindow();
    window?.setProgressBar(-1);
    setUpdateState(getMainWindow(), {
      status: "downloaded",
      availableVersion: info.version,
      percent: 100,
      message: "Update downloaded. Click Install now, approve the Windows prompt, and Lockedscreen will reopen when the update finishes."
    });
    showUpdateNotification(window, "Lockedscreen update ready", "Click Install now in Lockedscreen to finish the update.");
  });

  autoUpdater.on("error", (error) => {
    getMainWindow()?.setProgressBar(-1);
    updateInstallRequested = false;
    setUpdateState(getMainWindow(), {
      status: "error",
      percent: undefined,
      message: friendlyUpdateError(error)
    });
  });

  ipcMain.handle("updates:getState", async () => updateState);

  ipcMain.handle("updates:check", async () => {
    const window = getMainWindow();
    if (!app.isPackaged) {
      return setUpdateState(window, {
        status: "error",
        message: "Updates are available only in the installed app."
      });
    }

    try {
      if (updateState.status === "downloading") {
        return updateState;
      }

      setUpdateState(window, { status: "checking", message: "Checking for Lockedscreen updates..." });
      await autoUpdater.checkForUpdates();
    } catch (error) {
      setUpdateState(window, {
        status: "error",
        message: friendlyUpdateError(error)
      });
    }

    return updateState;
  });

  ipcMain.handle("updates:download", async () => {
    const window = getMainWindow();
    if (!app.isPackaged) {
      return setUpdateState(window, {
        status: "error",
        message: "Updates are available only in the installed app."
      });
    }

    try {
      if (updateState.status === "downloaded") {
        return updateState;
      }

      setUpdateState(window, { status: "downloading", percent: 0, message: "Downloading update..." });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      setUpdateState(window, {
        status: "error",
        percent: undefined,
        message: friendlyUpdateError(error)
      });
    }

    return updateState;
  });

  ipcMain.handle("updates:install", async () => {
    const window = getMainWindow();
    if (!app.isPackaged) {
      return setUpdateState(window, {
        status: "error",
        message: "Updates are available only in the installed app."
      });
    }

    if (updateInstallRequested || updateState.status === "installing") {
      return updateState;
    }

    if (updateState.status !== "downloaded") {
      return setUpdateState(window, {
        status: "error",
        message: "Download the update before installing it."
      });
    }

    updateInstallRequested = true;
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
      window.setProgressBar(2, { mode: "indeterminate" });
    }
    setUpdateState(window, {
      status: "installing",
      percent: 100,
      message:
        "Preparing the Windows installer. Keep this device on, follow the installer steps, and Lockedscreen will reopen when the update finishes."
    });
    showUpdateNotification(
      window,
      "Lockedscreen update is starting",
      "The Windows installer will open next. Keep the device on; Lockedscreen will reopen after installation."
    );

    try {
      await rememberPendingUpdate(updateState.availableVersion).catch(() => undefined);
      options.onBeforeInstall?.();
      setTimeout(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          window?.setProgressBar(-1);
          updateInstallRequested = false;
          setUpdateState(window, {
            status: "error",
            percent: undefined,
            message: friendlyUpdateError(error)
          });
        }
      }, updateInstallHandoffDelayMs);
    } catch (error) {
      window?.setProgressBar(-1);
      updateInstallRequested = false;
      setUpdateState(window, {
        status: "error",
        percent: undefined,
        message: friendlyUpdateError(error)
      });
    }

    return updateState;
  });
};

const checkForUpdatesQuietly = async (): Promise<void> => {
  if (!app.isPackaged) {
    return;
  }

  if (
    updateState.status === "checking" ||
    updateState.status === "downloading" ||
    updateState.status === "downloaded" ||
    updateState.status === "installing" ||
    updateState.status === "installed"
  ) {
    return;
  }

  await autoUpdater.checkForUpdates().catch(() => {
    // The updater emits a user-facing error state through the error handler.
  });
};

export const checkForAppUpdatesAfterStartup = (): void => {
  if (!app.isPackaged) {
    return;
  }

  setTimeout(() => {
    void checkForUpdatesQuietly();
  }, startupUpdateCheckDelayMs);

  if (periodicUpdateCheckTimer) {
    clearInterval(periodicUpdateCheckTimer);
  }

  periodicUpdateCheckTimer = setInterval(() => {
    void checkForUpdatesQuietly();
  }, periodicUpdateCheckIntervalMs);
};
