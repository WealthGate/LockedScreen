import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

import type { ExamConfigPackage, SecurityProfile, SessionStartRequest } from "@lockedscreen/shared-types";

type SecurityEventRecorder = (category: string, severity: string, message: string, details?: string) => Promise<void>;

interface NativeCompanionResponse {
  ok: boolean;
  message?: string;
  errorCode?: string;
  status?: {
    serviceMode?: string;
    sessionActive?: boolean;
  };
}

interface AgentStatusResponse {
  running: boolean;
  sessionId?: string;
  startedAt?: string;
  processId?: number;
}

interface AlternateDesktopLaunchRequest {
  examId: string;
  examMode: "app" | "link";
  packageId: string;
  route: string;
  shellExecutablePath: string;
  shellArgs: string[];
}

const developmentRoot = join(process.cwd(), "apps", "windows-lockdown");
const executableDir = dirname(process.execPath);
const nativeCommandTimeoutMs = 5000;

const candidateClientPaths = (): string[] => [
  join(process.resourcesPath, "lockedscreen-security", "Lockedscreen.Security.Client.exe"),
  join(process.resourcesPath, "Lockedscreen.Security.Client.exe"),
  join(executableDir, "lockedscreen-security", "Lockedscreen.Security.Client.exe"),
  join(executableDir, "Lockedscreen.Security.Client.exe"),
  join(
    developmentRoot,
    "Lockedscreen.Security.Client",
    "bin",
    "Release",
    "net8.0-windows",
    "Lockedscreen.Security.Client.exe"
  ),
  join(
    developmentRoot,
    "Lockedscreen.Security.Client",
    "bin",
    "Debug",
    "net8.0-windows",
    "Lockedscreen.Security.Client.exe"
  )
];

const candidateServicePaths = (): string[] => [
  join(process.resourcesPath, "lockedscreen-security", "Lockedscreen.Security.Service.exe"),
  join(process.resourcesPath, "Lockedscreen.Security.Service.exe"),
  join(executableDir, "lockedscreen-security", "Lockedscreen.Security.Service.exe"),
  join(executableDir, "Lockedscreen.Security.Service.exe"),
  join(
    developmentRoot,
    "Lockedscreen.Security.Service",
    "bin",
    "Release",
    "net8.0-windows",
    "Lockedscreen.Security.Service.exe"
  ),
  join(
    developmentRoot,
    "Lockedscreen.Security.Service",
    "bin",
    "Debug",
    "net8.0-windows",
    "Lockedscreen.Security.Service.exe"
  )
];

const candidateAgentPaths = (): string[] => [
  join(process.resourcesPath, "lockedscreen-security", "Lockedscreen.Security.Agent.exe"),
  join(process.resourcesPath, "Lockedscreen.Security.Agent.exe"),
  join(executableDir, "lockedscreen-security", "Lockedscreen.Security.Agent.exe"),
  join(executableDir, "Lockedscreen.Security.Agent.exe"),
  join(
    developmentRoot,
    "Lockedscreen.Security.Agent",
    "bin",
    "Release",
    "net8.0-windows",
    "Lockedscreen.Security.Agent.exe"
  ),
  join(
    developmentRoot,
    "Lockedscreen.Security.Agent",
    "bin",
    "Debug",
    "net8.0-windows",
    "Lockedscreen.Security.Agent.exe"
  )
];

const locateExecutable = (candidates: string[]): string | null =>
  candidates.find((candidate) => existsSync(candidate)) ?? null;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const runAgent = async (args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  const agentPath = locateExecutable(candidateAgentPaths());
  if (!agentPath) {
    throw new Error("Native Windows lockdown agent executable was not found.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(agentPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Native lockdown agent command "${args[0] ?? "run"}" timed out.`));
    }, nativeCommandTimeoutMs);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
};

const runClient = async (args: string[]): Promise<NativeCompanionResponse> => {
  const clientPath = locateExecutable(candidateClientPaths());
  if (!clientPath) {
    throw new Error("Native Windows lockdown client executable was not found.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(clientPath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Native lockdown client command "${args[0] ?? "status"}" timed out.`));
    }, nativeCommandTimeoutMs);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Native lockdown client exited with code ${code ?? 1}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as NativeCompanionResponse);
      } catch {
        reject(new Error("Native lockdown client returned an unreadable response."));
      }
    });
  });
};

const ensureCompanionDaemon = async (): Promise<void> => {
  try {
    const status = await runClient(["status"]);
    if (status.ok) {
      return;
    }
  } catch {
    // Start the daemon below.
  }

  const servicePath = locateExecutable(candidateServicePaths());
  if (!servicePath) {
    return;
  }

  const child = spawn(servicePath, ["serve"], {
    windowsHide: true,
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await wait(300);
    try {
      const status = await runClient(["status"]);
      if (status.ok) {
        return;
      }
    } catch {
      // Retry a few times before giving up.
    }
  }
};

const buildAgentPolicy = (request: SessionStartRequest, configPackage: ExamConfigPackage): string =>
  Buffer.from(
    JSON.stringify({
      sessionId: `${request.examId}:${request.packageId}:${Date.now()}`,
      hideTaskbar: configPackage.securityMode === "full-kiosk",
      blockSystemKeys: true,
      enforceProcesses: configPackage.processPolicy.enabled,
      disallowedProcessNames: configPackage.processPolicy.disallowedProcessNames,
      minimizeDisallowedForeground: true
    }),
    "utf-8"
  ).toString("base64");

const buildAlternateDesktopPolicy = (request: AlternateDesktopLaunchRequest, configPackage: ExamConfigPackage): string =>
  Buffer.from(
    JSON.stringify({
      sessionId: `${request.examId}:${request.packageId}:${Date.now()}`,
      hideTaskbar: false,
      blockSystemKeys: true,
      enforceProcesses: configPackage.processPolicy.enabled,
      disallowedProcessNames: configPackage.processPolicy.disallowedProcessNames,
      minimizeDisallowedForeground: true
    }),
    "utf-8"
  ).toString("base64");

const buildShellArgsPayload = (args: string[]): string =>
  Buffer.from(JSON.stringify(args), "utf-8").toString("base64");

const waitForAgentRunning = async (attempts: number, delayMs: number): Promise<AgentStatusResponse> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await wait(delayMs);
    }

    try {
      const status = await runAgent(["status"]);
      if (status.code !== 0) {
        lastError = new Error(status.stderr.trim() || "Unable to verify the native lockdown agent state.");
        continue;
      }

      const parsed = JSON.parse(status.stdout) as AgentStatusResponse;
      if (parsed.running) {
        return parsed;
      }

      lastError = new Error("The native lockdown agent did not stay active after launch.");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unable to verify the native lockdown agent state.");
    }
  }

  throw lastError ?? new Error("Unable to verify the native lockdown agent state.");
};

const ensureLockdownAgent = async (
  request: SessionStartRequest,
  configPackage: ExamConfigPackage,
  recordSecurityEvent: SecurityEventRecorder
): Promise<void> => {
  const stopResult = await runAgent(["stop"]);
  if (stopResult.code !== 0 && stopResult.stderr.trim()) {
    throw new Error(stopResult.stderr.trim());
  }

  await wait(200);

  const agentPath = locateExecutable(candidateAgentPaths());
  if (!agentPath) {
    throw new Error("Native Windows lockdown agent executable was not found.");
  }

  const policyBase64 = buildAgentPolicy(request, configPackage);
  const child = spawn(agentPath, ["run", policyBase64], {
    windowsHide: true,
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  const parsed = await waitForAgentRunning(8, 250);

  await recordSecurityEvent(
    "kiosk",
    "info",
    `Started the native lockdown agent for "${configPackage.label}".`,
    `PID ${parsed.processId ?? 0}`
  );
};

export const nativeCompanionRequired = (profile: SecurityProfile): boolean =>
  profile.nativeCompanionVerified &&
  (profile.kioskMode === "windows-native-companion" || profile.kioskMode === "hybrid");

export const beginNativeLockdownSession = async (
  request: SessionStartRequest,
  configPackage: ExamConfigPackage,
  recordSecurityEvent: SecurityEventRecorder
): Promise<void> => {
  await ensureCompanionDaemon();
  await ensureLockdownAgent(request, configPackage, recordSecurityEvent);
  const response = await runClient(["begin-session", request.examId, request.packageId, request.mode]);
  if (!response.ok) {
    throw new Error(response.message ?? "Native lockdown companion rejected the session start request.");
  }

  await recordSecurityEvent(
    "kiosk",
    "info",
    `Activated native Windows lockdown companion for "${configPackage.label}".`,
    response.status?.serviceMode ?? "active-session"
  );
};

export const launchAlternateDesktopExamShell = async (
  request: AlternateDesktopLaunchRequest,
  configPackage: ExamConfigPackage,
  recordSecurityEvent: SecurityEventRecorder
): Promise<void> => {
  await ensureCompanionDaemon();

  const agentPath = locateExecutable(candidateAgentPaths());
  if (!agentPath) {
    throw new Error("Native Windows lockdown agent executable was not found.");
  }

  const policyBase64 = buildAlternateDesktopPolicy(request, configPackage);
  const shellArgsBase64 = buildShellArgsPayload(request.shellArgs);

  const host = spawn(agentPath, ["host-shell", policyBase64, request.shellExecutablePath, shellArgsBase64], {
    windowsHide: true,
    detached: true,
    stdio: "ignore"
  });
  host.unref();

  try {
    await waitForAgentRunning(16, 250);

    const response = await runClient(["begin-session", request.examId, request.packageId, request.examMode]);
    if (!response.ok) {
      throw new Error(response.message ?? "Native lockdown companion rejected the alternate desktop launch request.");
    }
  } catch (error) {
    await runAgent(["stop"]).catch(() => undefined);
    throw error;
  }

  await recordSecurityEvent(
    "kiosk",
    "info",
    `Launched alternate desktop exam shell for "${configPackage.label}".`,
    `Route ${request.route}`
  );
};

export const endNativeLockdownSession = async (recordSecurityEvent: SecurityEventRecorder): Promise<void> => {
  let released = false;
  try {
    const stopResult = await runAgent(["stop"]);
    if (stopResult.code !== 0) {
      await recordSecurityEvent(
        "kiosk",
        "warning",
        "Native Windows lockdown agent stop returned a non-zero status.",
        stopResult.stderr.trim() || stopResult.stdout.trim() || `Exit code ${stopResult.code ?? 1}`
      );
    }
  } catch (error) {
    await recordSecurityEvent(
      "kiosk",
      "warning",
      "Native Windows lockdown agent stop did not confirm before release continued.",
      error instanceof Error ? error.message : "Unknown native agent stop error."
    );
  }

  try {
    const response = await runClient(["end-session", "Electron session ended"]);
    if (response.ok) {
      released = true;
      await recordSecurityEvent("kiosk", "info", "Released native Windows lockdown companion.", response.message);
    }
  } catch (error) {
    await recordSecurityEvent(
      "kiosk",
      released ? "info" : "warning",
      "Native Windows lockdown companion release did not confirm before app cleanup continued.",
      error instanceof Error ? error.message : "Unknown native companion release error."
    );
  }
};
