import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { QuitUnlockPolicy } from "@lockedscreen/shared-types";

export const isPinVerifier = (value: unknown): value is NonNullable<QuitUnlockPolicy["pinVerifier"]> => {
  if (typeof value !== "object" || !value) return false;
  const verifier = value as Record<string, unknown>;
  return typeof verifier.salt === "string" && /^[a-f0-9]{32}$/.test(verifier.salt) &&
    typeof verifier.digest === "string" && /^[a-f0-9]{64}$/.test(verifier.digest);
};

export const createPinVerifier = (pin: string): NonNullable<QuitUnlockPolicy["pinVerifier"]> => {
  if (!pin.trim()) throw new Error("Set an invigilator exit PIN before exporting a student exam package.");
  if (pin.length > 128) throw new Error("The invigilator PIN must be at most 128 characters.");
  const salt = randomBytes(16).toString("hex");
  return { salt, digest: scryptSync(pin.trim(), salt, 32).toString("hex") };
};

export const verifyInvigilatorPin = (pin: unknown, verifier: QuitUnlockPolicy["pinVerifier"]): boolean => {
  if (typeof pin !== "string" || pin.length > 128 || !isPinVerifier(verifier)) return false;
  return timingSafeEqual(scryptSync(pin.trim(), verifier.salt, 32), Buffer.from(verifier.digest, "hex"));
};
