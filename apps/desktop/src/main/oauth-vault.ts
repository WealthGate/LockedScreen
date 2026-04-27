import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { safeStorage } from "electron";

import type { OAuthTokenBundle, SecureTokenStore } from "./integrations/google";

type VaultContent = Record<string, string>;

const connectionKey = (connectionId: string): string => createHash("sha256").update(connectionId).digest("hex");

/**
 * Per-teacher OAuth token vault.
 *
 * The app stores machine/admin Google integration settings in normal app state,
 * but teacher tokens live here under a hashed connection ID. The JSON file is
 * only a transport for encrypted blobs: safeStorage encrypts the token bundle
 * with the operating system's desktop secret protection before any write.
 */
export class OAuthVault implements SecureTokenStore {
  constructor(private readonly filePath: string) {}

  private async readVault(): Promise<VaultContent> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as VaultContent;
    } catch {
      return {};
    }
  }

  private async writeVault(content: VaultContent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(content, null, 2), "utf-8");
  }

  private requireEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure token storage is not available on this device.");
    }
  }

  async saveTokens(connectionId: string, tokens: OAuthTokenBundle): Promise<void> {
    this.requireEncryption();
    const vault = await this.readVault();
    vault[connectionKey(connectionId)] = safeStorage.encryptString(JSON.stringify(tokens)).toString("base64");
    await this.writeVault(vault);
  }

  async getTokens(connectionId: string): Promise<OAuthTokenBundle | null> {
    this.requireEncryption();
    const vault = await this.readVault();
    const raw = vault[connectionKey(connectionId)];
    if (!raw) {
      return null;
    }

    const decrypted = safeStorage.decryptString(Buffer.from(raw, "base64"));
    return JSON.parse(decrypted) as OAuthTokenBundle;
  }

  async deleteTokens(connectionId: string): Promise<void> {
    const vault = await this.readVault();
    delete vault[connectionKey(connectionId)];
    await this.writeVault(vault);
  }
}
