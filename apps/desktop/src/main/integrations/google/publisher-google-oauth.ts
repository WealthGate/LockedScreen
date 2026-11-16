import type { AppStateSnapshot, GoogleIntegrationSettings } from "@lockedscreen/shared-types";
import { createDefaultGoogleIntegrationSettings } from "./google-integration-settings";

type DesktopClient = { clientId: string; clientSecret: string };
declare const __LOCKEDSCREEN_PUBLISHER_GOOGLE_OAUTH__: DesktopClient | null;

export const publisherGoogleOAuth = typeof __LOCKEDSCREEN_PUBLISHER_GOOGLE_OAUTH__ === "undefined"
  ? null : __LOCKEDSCREEN_PUBLISHER_GOOGLE_OAUTH__;

export const getPublisherGoogleDefaults = (
  snapshot: Pick<AppStateSnapshot, "settings" | "lmsConnections">,
  client: DesktopClient | null
): GoogleIntegrationSettings | null => {
  const settings = snapshot.settings.googleIntegration;
  if (!client || settings.clientId.trim() ||
      snapshot.lmsConnections.some((connection) => connection.provider === "google-classroom")) {
    return null;
  }

  return { ...createDefaultGoogleIntegrationSettings(), ...client, enabled: true };
};
