import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";
import updater from "electron-updater";

import type { AppUpdateState } from "@lockedscreen/shared-types";

const { autoUpdater } = updater;

const updateCacheFilePattern = /lockedscreen.*\.(exe|blockmap|yml)$/i;

let updateState: AppUpdateState = {
  status: "idle",
  currentVersion: app.getVersion()
};

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

export const configureAppUpdates = (getMainWindow: () => BrowserWindow | null): void => {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  void cleanupOldUpdateFiles();

  autoUpdater.on("checking-for-update", () => {
    setUpdateState(getMainWindow(), {
      status: "checking",
      percent: undefined,
      message: "Checking for Lockedscreen updates..."
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState(getMainWindow(), {
      status: "available",
      availableVersion: info.version,
      releaseName: info.releaseName ?? undefined,
      releaseDate: info.releaseDate,
      percent: undefined,
      message: `Lockedscreen ${info.version} is available.`
    });
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
    setUpdateState(getMainWindow(), {
      status: "downloaded",
      availableVersion: info.version,
      percent: 100,
      message: "Update downloaded. Restart Lockedscreen to install it."
    });
  });

  autoUpdater.on("error", (error) => {
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
    autoUpdater.quitAndInstall(false, true);
  });
};

export const checkForAppUpdatesAfterStartup = (): void => {
  if (!app.isPackaged) {
    return;
  }

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {
      // The updater emits a user-facing error state through the error handler.
    });
  }, 15000);
};
