type WakeLockSentinelLike = {
  release: () => Promise<void>;
};

let wakeLock: WakeLockSentinelLike | null = null;

export const enterMobileExamShell = async (): Promise<string[]> => {
  const warnings: string[] = [];

  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    warnings.push("Fullscreen could not be activated on this device.");
  }

  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: "portrait") => Promise<void>;
    };
    await orientation.lock?.("portrait");
  } catch {
    warnings.push("Screen orientation lock is not available on this device.");
  }

  try {
    const navigatorWithWakeLock = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    wakeLock = (await navigatorWithWakeLock.wakeLock?.request("screen")) ?? null;
  } catch {
    warnings.push("Screen wake lock is not available on this device.");
  }

  return warnings;
};

export const leaveMobileExamShell = async (): Promise<void> => {
  try {
    await wakeLock?.release();
  } catch {
    // The OS may already have released the wake lock.
  } finally {
    wakeLock = null;
  }

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    // Leaving fullscreen is best-effort after submission.
  }
};
