import type { GoogleIntegrationSettings, LmsConnectionStatus } from "@lockedscreen/shared-types";

export const googleClassroomDesktopOAuth = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  classroomApiBaseUrl: "https://classroom.googleapis.com/v1",
  driveUploadBaseUrl: "https://www.googleapis.com/upload/drive/v3"
} as const;

export const defaultGoogleClassroomScopes = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/classroom.coursework.me"
] as const;

const normalizeGoogleScope = (scope: string): string => {
  const trimmed = scope.trim();
  if (trimmed === "email") {
    return "https://www.googleapis.com/auth/userinfo.email";
  }
  if (trimmed === "profile") {
    return "https://www.googleapis.com/auth/userinfo.profile";
  }
  return trimmed;
};

export const createDefaultGoogleIntegrationSettings = (): GoogleIntegrationSettings => ({
  enabled: false,
  clientId: "",
  clientSecret: "",
  requestedScopes: [...defaultGoogleClassroomScopes],
  connectionStatus: "disconnected",
  accountEmail: "",
  accountName: "",
  lastConnectedAt: undefined,
  lastError: undefined
});

export const normalizeGoogleIntegrationSettings = (
  settings: Partial<GoogleIntegrationSettings> | null | undefined
): GoogleIntegrationSettings => {
  const requestedScopes = Array.isArray(settings?.requestedScopes)
    ? Array.from(new Set(settings.requestedScopes.map(normalizeGoogleScope).filter(Boolean)))
    : [...defaultGoogleClassroomScopes];

  return {
    ...createDefaultGoogleIntegrationSettings(),
    ...(settings ?? {}),
    enabled: settings?.enabled === true,
    clientId: settings?.clientId?.trim() ?? "",
    clientSecret: settings?.clientSecret?.trim() ?? "",
    requestedScopes,
    connectionStatus: normalizeConnectionStatus(settings?.connectionStatus),
    accountEmail: settings?.accountEmail?.trim() ?? "",
    accountName: settings?.accountName?.trim() ?? "",
    lastConnectedAt: settings?.lastConnectedAt,
    lastError: settings?.lastError
  };
};

export const googleScopesToString = (settings: GoogleIntegrationSettings): string =>
  normalizeGoogleIntegrationSettings(settings).requestedScopes.join(" ");

export const parseGoogleScopes = (value: string): string[] =>
  value
    .split(/[\s,\n\r]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

export const validateGoogleIntegrationSettings = (settings: GoogleIntegrationSettings): void => {
  const normalized = normalizeGoogleIntegrationSettings(settings);
  if (!normalized.enabled) {
    return;
  }

  if (!normalized.clientId) {
    throw new Error("Google Classroom is not configured yet. Ask an admin to add the Google desktop app client ID in the Admin Console.");
  }

  if (normalized.requestedScopes.length === 0) {
    throw new Error("Google Classroom integration needs at least one requested permission.");
  }
};

const normalizeConnectionStatus = (status: unknown): LmsConnectionStatus =>
  status === "connected" || status === "error" ? status : "disconnected";
