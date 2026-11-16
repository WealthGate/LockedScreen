import { readFileSync } from "node:fs";

export const readPublisherGoogleOAuth = (path?: string) => {
  if (!path) return null;

  try {
    const { installed } = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof installed?.client_id !== "string" ||
      !/^129421335486-[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(installed.client_id) ||
      installed.project_id !== "lockedscreen" ||
      typeof installed.client_secret !== "string" ||
      !installed.client_secret.trim()
    ) {
      throw new Error();
    }
    return { clientId: installed.client_id, clientSecret: installed.client_secret.trim() };
  } catch {
    throw new Error("LOCKEDSCREEN_GOOGLE_OAUTH_FILE must point to a Google Desktop app OAuth JSON export for project lockedscreen (129421335486).");
  }
};
