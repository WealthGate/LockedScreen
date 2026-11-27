import type { AppStateSnapshot } from "@lockedscreen/shared-types";

export const waitForSessionRelease = async (
  operation: Promise<AppStateSnapshot | null>, timeoutMs = 5000
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation.then(snapshot => Boolean(snapshot && !snapshot.activeSession)),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
};
