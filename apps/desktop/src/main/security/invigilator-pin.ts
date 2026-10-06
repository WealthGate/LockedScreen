import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { QuitUnlockPolicy } from "@lockedscreen/shared-types";

export const createPinVerifier = (pin: string): NonNullable<QuitUnlockPolicy["pinVerifier"]> => {
  if (!pin.trim()) throw new Error("Set an invigilator exit PIN before exporting a student exam package.");
  const salt = randomBytes(16).toString("hex");
  return { salt, digest: scryptSync(pin.trim(), salt, 32).toString("hex") };
};

export const verifyInvigilatorPin = (pin: unknown, verifier: QuitUnlockPolicy["pinVerifier"]): boolean => {
  if (typeof pin !== "string" || pin.length > 128 || !verifier ||
    !/^[a-f0-9]{32}$/.test(verifier.salt) || !/^[a-f0-9]{64}$/.test(verifier.digest)) return false;
  return timingSafeEqual(scryptSync(pin.trim(), verifier.salt, 32), Buffer.from(verifier.digest, "hex"));
};
