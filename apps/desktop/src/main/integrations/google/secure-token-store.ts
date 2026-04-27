export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

/**
 * Stores per-teacher OAuth tokens outside the admin integration config.
 *
 * Implementations must never persist raw access or refresh tokens. On Windows
 * the Electron implementation uses OS-backed encryption through safeStorage
 * before writing the token bundle to disk.
 */
export interface SecureTokenStore {
  saveTokens(connectionId: string, tokens: OAuthTokenBundle): Promise<void>;
  getTokens(connectionId: string): Promise<OAuthTokenBundle | null>;
  deleteTokens(connectionId: string): Promise<void>;
}
