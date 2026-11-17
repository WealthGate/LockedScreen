import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { publisherGoogleConnection } from "@lockedscreen/shared-types";
import type { OAuthTokenBundle } from "./secure-token-store";

interface HostedResult {
  accessToken: string;
  expiresAt: string;
  sessionToken?: string;
  profile?: { email?: string; name?: string };
}
const origin = publisherGoogleConnection.origin;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const request = async (path: string, body: unknown, sessionToken?: string) => {
  const response = await fetch(`${origin}${path}`, {
    method: "POST", headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {})
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: "error"
  }).catch(() => { throw new Error("Could not reach the LockedScreen Google connection service. Check your connection and try again."); });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const message = typeof payload?.message === "string" ? payload.message.slice(0, 700) : "The LockedScreen Google connection service is not ready. Contact the publisher.";
    throw new Error(message);
  }
  return { response, payload };
};

export const beginHostedGoogleSignIn = async (
  role: "teacher" | "student",
  openBrowser: (url: string) => Promise<unknown>
): Promise<HostedResult> => {
  const verifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const { payload } = await request("/v1/google/sign-in", { role, codeChallenge });
  if (typeof payload.flowId !== "string" || !tokenPattern.test(payload.flowId) ||
      payload.authorizeUrl !== `${origin}/oauth/google/start?flow=${payload.flowId}`) {
    throw new Error("The Google connection service returned an invalid sign-in address.");
  }
  await openBrowser(payload.authorizeUrl);
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await delay(5000);
    const { response, payload: result } = await request("/v1/google/claim", { flowId: payload.flowId, codeVerifier: verifier });
    if (response.status === 202) continue;
    if (typeof result.accessToken !== "string" || typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt)) ||
        (role === "teacher" && (typeof result.sessionToken !== "string" || !tokenPattern.test(result.sessionToken)))) {
      throw new Error("The Google connection service returned an incomplete sign-in result.");
    }
    return result as unknown as HostedResult;
  }
  throw new Error("Google sign-in timed out. Select Connect Google Classroom to try again.");
};

export const refreshHostedGoogleToken = async (sessionToken: string): Promise<OAuthTokenBundle> => {
  if (!tokenPattern.test(sessionToken)) throw new Error("Reconnect Google Classroom on this device.");
  const { payload } = await request("/v1/google/access-token", {}, sessionToken);
  if (typeof payload.accessToken !== "string" || typeof payload.expiresAt !== "string") throw new Error("Google Classroom needs you to reconnect.");
  return { accessToken: payload.accessToken, expiresAt: payload.expiresAt, hostedSessionToken: sessionToken };
};

export const disconnectHostedGoogle = async (sessionToken: string, revoke: boolean): Promise<void> => {
  await request("/v1/google/disconnect", { revoke }, sessionToken);
};
