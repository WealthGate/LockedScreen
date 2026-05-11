import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { screen } from "electron";

import type {
  AppStateSnapshot,
  EnvironmentCheckResult,
  ExamConfigPackage,
  PackageIntegritySummary,
  ProcessMonitorSummary,
  ProcessObservation,
  RuntimeEnvironment,
  SecurityOverview,
  ValidationItem,
  VerificationStatus
} from "@lockedscreen/shared-types";
import { calculateConfigPackageChecksum } from "@lockedscreen/storage";

export const detectWindowsEdition = (): RuntimeEnvironment["windowsEdition"] => {
  if (process.platform !== "win32") {
    return undefined;
  }

  try {
    const editionId = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID"
      ],
      { encoding: "utf-8", windowsHide: true }
    ).trim();

    switch (editionId) {
      case "Core":
      case "CoreCountrySpecific":
      case "CoreSingleLanguage":
        return "home";
      case "Professional":
      case "ProfessionalN":
        return "pro";
      case "Enterprise":
      case "EnterpriseN":
        return "enterprise";
      case "Education":
      case "EducationN":
        return "education";
      case "IoTEnterprise":
        return "iot-enterprise";
      default:
        return "unknown";
    }
  } catch {
    return "unknown";
  }
};

const candidateNativeHelperPaths = (): string[] => {
  const exeDir = dirname(process.execPath);
  const developmentRoot = join(process.cwd(), "apps", "windows-lockdown", "Lockedscreen.Security.Client", "bin");
  return [
    join(process.resourcesPath, "lockedscreen-security", "Lockedscreen.Security.Client.exe"),
    join(process.resourcesPath, "Lockedscreen.Security.Client.exe"),
    join(exeDir, "Lockedscreen.Security.Client.exe"),
    join(exeDir, "lockedscreen-security", "Lockedscreen.Security.Client.exe"),
    join(developmentRoot, "Release", "net8.0-windows", "Lockedscreen.Security.Client.exe"),
    join(developmentRoot, "Debug", "net8.0-windows", "Lockedscreen.Security.Client.exe")
  ];
};

const detectNativeLockdownEnvironment = (): RuntimeEnvironment["nativeLockdown"] => {
  if (process.platform !== "win32") {
    return {
      supported: false,
      helperPresent: false,
      servicePresent: false,
      serviceRunning: false,
      lockdownCapable: false,
      featureLevel: "none",
      detail: "Native Windows lockdown is only available on Windows."
    };
  }

  const helperPath = candidateNativeHelperPaths().find((candidate) => existsSync(candidate));

  let serviceState = "missing";
  try {
    serviceState = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$svc = Get-Service -Name 'LockedscreenSecurityService' -ErrorAction SilentlyContinue; if ($null -eq $svc) { 'missing' } else { $svc.Status }"
      ],
      { encoding: "utf-8", windowsHide: true }
    )
      .trim()
      .toLowerCase();
  } catch {
    serviceState = "missing";
  }

  const servicePresent = serviceState !== "" && serviceState !== "missing";
  const serviceRunning = serviceState === "running";
  const lockdownCapable = Boolean(helperPath) && serviceRunning;
  const featureLevel =
    lockdownCapable ? "desktop-lockdown" : helperPath || servicePresent ? "partial" : "none";

  return {
    supported: true,
    helperPresent: Boolean(helperPath),
    helperPath,
    servicePresent,
    serviceRunning,
    lockdownCapable,
    featureLevel,
    detail: lockdownCapable
      ? "Native Windows lockdown helper and service were detected."
      : featureLevel === "partial"
        ? "A native Windows lockdown component is partially present, but the full helper/service pair is not active."
        : "No native Windows lockdown helper or service was detected."
  };
};

export const createRuntimeEnvironment = (): RuntimeEnvironment => {
  const windowsEdition = detectWindowsEdition();
  const supportsAssignedAccess =
    windowsEdition === "pro" ||
    windowsEdition === "enterprise" ||
    windowsEdition === "education" ||
    windowsEdition === "iot-enterprise";
  const supportsShellLauncher =
    windowsEdition === "enterprise" || windowsEdition === "education" || windowsEdition === "iot-enterprise";
  const nativeLockdown = detectNativeLockdownEnvironment();

  return {
    platform:
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : process.platform === "linux"
            ? "linux"
            : "unknown",
    windowsEdition,
    supportsAssignedAccess,
    supportsShellLauncher,
    supportsWindowsNativeLockdown: process.platform === "win32",
    nativeLockdown,
    canOnlyUseTestingMode:
      process.platform !== "win32" ||
      (process.platform === "win32" && windowsEdition === "home" && !nativeLockdown.lockdownCapable)
  };
};

const execFileAsync = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, encoding: "utf-8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });

const packageIntegritySummary = (candidate: ExamConfigPackage): PackageIntegritySummary => {
  const checksum = calculateConfigPackageChecksum(candidate);
  const status: VerificationStatus = checksum === candidate.integrity.checksum ? "pass" : "fail";
  return {
    packageId: candidate.id,
    examId: candidate.examId,
    label: candidate.label,
    securityMode: candidate.securityMode,
    status,
    detail:
      status === "pass"
        ? "Configuration package checksum matches the stored integrity record."
        : "Stored checksum does not match the current package contents.",
    checksum: candidate.integrity.checksum,
    lastValidatedAt: candidate.integrity.lastValidatedAt
  };
};

const getProcessObservations = async (configPackages: ExamConfigPackage[]): Promise<ProcessObservation[]> => {
  if (process.platform !== "win32") {
    return [];
  }

  const allowed = new Set(
    configPackages.flatMap((candidate) => candidate.processPolicy.allowedProcessNames.map((entry) => entry.toLowerCase()))
  );
  const disallowed = new Set(
    configPackages.flatMap((candidate) => candidate.processPolicy.disallowedProcessNames.map((entry) => entry.toLowerCase()))
  );

  if (allowed.size === 0 && disallowed.size === 0) {
    return [];
  }

  try {
    const output = await execFileAsync("tasklist.exe", ["/fo", "csv", "/nh"]);
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(1, -1).split('","'))
      .map(([name, pid]) => {
        const safeName = name ?? "unknown";
        const normalized = safeName.toLowerCase();
        return {
          pid: Number.parseInt(pid ?? "0", 10) || 0,
          name: safeName,
          disposition: disallowed.has(normalized) ? "disallowed" : allowed.has(normalized) ? "allowed" : "review"
        } satisfies ProcessObservation;
      })
      .filter((entry) => entry.pid > 0);
  } catch {
    return [];
  }
};

const getProcessSummary = async (configPackages: ExamConfigPackage[]): Promise<ProcessMonitorSummary> => {
  const monitored = configPackages.some((candidate) => candidate.processPolicy.enabled);
  if (!monitored) {
    return {
      monitored: false,
      allowed: 0,
      review: 0,
      disallowed: 0,
      observations: []
    };
  }

  const observations = await getProcessObservations(configPackages);
  return {
    monitored: true,
    allowed: observations.filter((entry) => entry.disposition === "allowed").length,
    review: observations.filter((entry) => entry.disposition === "review").length,
    disallowed: observations.filter((entry) => entry.disposition === "disallowed").length,
    lastScanAt: new Date().toISOString(),
    observations
  };
};

const buildEnvironmentChecks = async (configPackage: ExamConfigPackage | null): Promise<EnvironmentCheckResult[]> => {
  const policy = configPackage?.environmentPolicy;
  if (!policy) {
    return [];
  }

  const displays = screen.getAllDisplays().length;
  const remoteSession =
    process.platform === "win32" &&
    ((process.env.SESSIONNAME ?? "").toLowerCase().includes("rdp") || Boolean(process.env.CLIENTNAME));

  let vmObserved = "Unknown";
  let vmStatus: VerificationStatus = "info";
  if (process.platform === "win32") {
    try {
      const output = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "(Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Manufacturer) + '|' + (Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Model)"
      ]);
      const normalized = output.trim().toLowerCase();
      vmObserved = output.trim();
      vmStatus =
        normalized.includes("vmware") ||
        normalized.includes("virtual") ||
        normalized.includes("hyper-v") ||
        normalized.includes("virtualbox") ||
        normalized.includes("qemu")
          ? "warn"
          : "pass";
    } catch {
      vmStatus = "info";
    }
  }

  return [
    {
      id: "vm",
      label: "Virtual machine posture",
      status: policy.virtualMachine.enabled ? vmStatus : "info",
      enforcement: policy.virtualMachine.enforcement,
      detail: "VM detection is heuristic and should be combined with managed-device policy.",
      observedValue: vmObserved
    },
    {
      id: "displays",
      label: "Multiple display policy",
      status: displays > 1 ? "warn" : "pass",
      enforcement: policy.multipleDisplays.enforcement,
      detail:
        displays > 1
          ? `Detected ${displays} attached displays. Full blocking depends on Windows kiosk deployment and device policy.`
          : "Single-display posture detected.",
      observedValue: `${displays} display(s)`
    },
    {
      id: "remote-session",
      label: "Remote session / screen-sharing posture",
      status: remoteSession ? "warn" : "pass",
      enforcement: policy.remoteSession.enforcement,
      detail:
        remoteSession
          ? "A remote-session indicator was detected. App-level detection is advisory and should be reviewed."
          : "No remote-session indicator detected."
    },
    {
      id: "capture",
      label: "Screen capture policy",
      status: configPackage.capturePolicy.mode === "allow-in-app-only" ? "warn" : "info",
      enforcement: configPackage.capturePolicy.enforcement,
      detail:
        configPackage.capturePolicy.mode === "allow-in-app-only"
          ? "In-app capture paths can be limited, but full OS screenshot control depends on Windows policy."
          : "Capture posture is advisory for this package."
    },
    {
      id: "printing",
      label: "Printing policy",
      status: configPackage.printPolicy.mode === "block" ? "pass" : "info",
      enforcement: configPackage.printPolicy.enforcement,
      detail:
        configPackage.printPolicy.mode === "block"
          ? "App-level print shortcuts are blocked during managed sessions."
          : "Printing is allowed by this package."
    },
    {
      id: "clipboard",
      label: "Clipboard policy",
      status: configPackage.clipboardPolicy.mode === "allow" ? "info" : "pass",
      enforcement: configPackage.clipboardPolicy.enforcement,
      detail:
        configPackage.clipboardPolicy.mode === "allow"
          ? "Clipboard remains available."
          : "Clipboard shortcuts are restricted while the session policy is active."
    }
  ];
};

const buildValidationItems = (
  snapshot: AppStateSnapshot,
  runtime: RuntimeEnvironment,
  packageSummaries: PackageIntegritySummary[],
  environmentChecks: EnvironmentCheckResult[],
  processSummary: ProcessMonitorSummary,
  activePackage: ExamConfigPackage | null
): ValidationItem[] => {
  const officialKioskReady =
    snapshot.securityProfile.kioskConfigured &&
    snapshot.securityProfile.dedicatedExamAccount &&
    (snapshot.securityProfile.kioskMode === "assigned-access" ||
      snapshot.securityProfile.kioskMode === "shell-launcher" ||
      snapshot.securityProfile.kioskMode === "hybrid");
  const nativeLockdownReady =
    runtime.nativeLockdown.lockdownCapable &&
    (runtime.platform === "windows" ||
      (snapshot.securityProfile.nativeCompanionVerified &&
        (snapshot.securityProfile.kioskMode === "windows-native-companion" ||
          snapshot.securityProfile.kioskMode === "hybrid")));
  const deploymentReady = officialKioskReady || nativeLockdownReady;
  const fullKioskRequested = snapshot.configPackages.some((candidate) => candidate.securityMode === "full-kiosk");

  return [
    {
      id: "package-integrity",
      label: "Configuration package integrity",
      status: packageSummaries.every((entry) => entry.status === "pass") ? "pass" : "fail",
      enforcement: "app-enforced",
      detail: "The kiosk component validates the stored checksum for each configuration package."
    },
    {
      id: "native-lockdown",
      label: "Native Windows lockdown companion",
      status: !runtime.supportsWindowsNativeLockdown
        ? "info"
        : nativeLockdownReady
          ? "pass"
          : runtime.nativeLockdown.featureLevel === "partial"
            ? "warn"
            : fullKioskRequested
              ? "warn"
              : "info",
      enforcement: "native-companion-enforced",
      detail: !runtime.supportsWindowsNativeLockdown
        ? "Native Windows lockdown is not available on this operating system."
        : nativeLockdownReady
          ? "A verified native helper/service pair is available for desktop isolation, process supervision, and Windows-specific lockdown."
          : runtime.nativeLockdown.detail
    },
    {
      id: "deployment",
      label: "Windows secure deployment",
      status: deploymentReady ? "pass" : fullKioskRequested ? "warn" : "info",
      enforcement: officialKioskReady ? "os-kiosk-enforced" : nativeLockdownReady ? "native-companion-enforced" : "advisory",
      detail: nativeLockdownReady && officialKioskReady
        ? "Hybrid deployment is verified: native Windows lockdown companion plus official kiosk controls."
        : nativeLockdownReady
          ? "A verified native Windows lockdown companion is available for high-stakes sessions without relying only on Windows edition-specific kiosk features."
          : officialKioskReady
            ? "An administrator has recorded Assigned Access or Shell Launcher deployment for the exam account."
            : "Full Kiosk Mode packages exist, but their strongest restrictions still depend on a verified native Windows lockdown companion or official Windows kiosk deployment."
    },
    {
      id: "runtime-policy",
      label: "Active runtime policy",
      status: activePackage ? "pass" : "info",
      enforcement: "app-enforced",
      detail: activePackage
        ? `Session policy is active for "${activePackage.label}" in ${activePackage.securityMode} mode.`
        : "No student session is active. The admin console is operating outside a restricted session."
    },
    {
      id: "environment",
      label: "Environment checks",
      status: environmentChecks.some((entry) => entry.status === "warn") ? "warn" : "pass",
      enforcement: "advisory",
      detail: "Environment checks are visible to administrators with explicit enforcement labels per control."
    },
    {
      id: "process-policy",
      label: "Process policy monitor",
      status: !processSummary.monitored ? "info" : processSummary.disallowed > 0 ? "warn" : "pass",
      enforcement: "advisory",
      detail: !processSummary.monitored
        ? "Process monitoring is disabled for the current package."
        : "The kiosk component tracks observed processes and logs review-worthy violations."
    }
  ];
};

export const buildSecurityOverview = async (
  snapshot: AppStateSnapshot,
  runtime: RuntimeEnvironment,
  activePackage: ExamConfigPackage | null
): Promise<SecurityOverview> => {
  const packageSummaries = snapshot.configPackages.map(packageIntegritySummary);
  const relevantPackages = activePackage ? [activePackage] : snapshot.configPackages;
  const environmentChecks = await buildEnvironmentChecks(activePackage ?? snapshot.configPackages[0] ?? null);
  const processSummary = await getProcessSummary(relevantPackages);

  return {
    deploymentMode: snapshot.configPackages.some((candidate) => candidate.securityMode === "full-kiosk")
      ? "full-kiosk"
      : "restricted-app",
    deploymentRecommendation:
      "Full Kiosk Mode is the recommended deployment for high-stakes exams. Restricted App Mode keeps the runtime controlled, but the strongest Windows lockdown depends on a verified native Windows companion or official kiosk deployment.",
    packageSummaries,
    environmentChecks,
    validationItems: buildValidationItems(snapshot, runtime, packageSummaries, environmentChecks, processSummary, activePackage),
    processSummary
  };
};
