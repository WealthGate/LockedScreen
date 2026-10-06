import type { InstalledAppRole } from "@lockedscreen/shared-types";

declare const __LOCKEDSCREEN_EDITION__: "student" | "teacher" | "selectable";
declare const __LOCKEDSCREEN_STORE_PRODUCT_ID__: string;

export const buildEdition = typeof __LOCKEDSCREEN_EDITION__ === "undefined"
  ? "selectable" : __LOCKEDSCREEN_EDITION__;
export const storeProductId = typeof __LOCKEDSCREEN_STORE_PRODUCT_ID__ === "undefined"
  ? "9NRCCBKRLXBJ" : __LOCKEDSCREEN_STORE_PRODUCT_ID__;

const studentChannels = new Set([
  "app:getSnapshot", "app:getLaunchContext", "security:refreshOverview",
  "exam:hideForStudent", "configPackage:import",
  "session:begin", "session:launchAlternateDesktop", "session:end",
  "applications:launch", "exam:submit", "studentLms:turnIn",
  "window:setAssistKiosk", "window:setNavigationGuard", "shell:openExternal"
]);

export const assertRoleAccess = (role: InstalledAppRole, channel: string): void => {
  if (role === "student" && !studentChannels.has(channel)) {
    throw new Error("This operation requires the Teacher edition of LockedScreen.");
  }
};
