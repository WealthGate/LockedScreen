const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const randomToken = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

export const hash = async (value: string): Promise<string> =>
  base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

const encryptionKey = async (secret: string): Promise<CryptoKey> => {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret)) throw new Error("Invalid encryption key configuration.");
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(secret), (value) => value.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]);
};

export const seal = async (secret: string, context: string, value: unknown): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await encryptionKey(secret), encoder.encode(JSON.stringify(value))
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
};

export const unseal = async <T>(secret: string, context: string, value: string): Promise<T> => {
  const [version, nonce, encrypted] = value.split(".");
  if (version !== "v1" || !nonce || !encrypted) throw new Error("Invalid encrypted record.");
  const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(nonce), additionalData: encoder.encode(context) },
    await encryptionKey(secret), decode(encrypted)
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
};
