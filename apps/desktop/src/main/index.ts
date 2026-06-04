import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";

import { extractExamDocumentText, parseExamDocument } from "@lockedscreen/parser";
import type {
  Candidate,
  AppSettings,
  AppStateSnapshot,
  Exam,
  ExamConfigPackage,
  ExamSession,
  GoogleClassroomPublishResult,
  LaunchContext,
  InstalledAppRole,
  LmsConnection,
  LmsCourse,
  LmsCourseWork,
  LmsStudent,
  NavigationGuard,
  ProtectedPackageLaunchInfo,
  ResultDestination,
  RuntimeEnvironment,
  SecurityProfile,
  StudentLmsTurnInState,
  SubmissionResult,
  SessionStartRequest
} from "@lockedscreen/shared-types";
import { createStorageService } from "@lockedscreen/storage";

import {
  beginLmsOAuthConnection,
  getConnectionAccessToken,
  listConnectionCourses,
  listConnectionCourseWork,
  listConnectionStudents,
  publishConnectionCourseWork,
  signOutLmsConnection
} from "./lms-oauth";
import { OAuthVault } from "./oauth-vault";
import { createDisabledSyncState, syncSubmissionToDestination } from "./results-sync";
import { buildSecurityOverview, createRuntimeEnvironment } from "./security/diagnostics";
import {
  beginNativeLockdownSession,
  endNativeLockdownSession,
  launchAlternateDesktopExamShell,
  nativeCompanionRequired
} from "./security/native-security";

const questionAuthoringTemplate = `LOCKEDSCREEN Question Authoring Template

Use either format below. Keep one answer option per line. Scanned PDFs and image files can be imported with OCR, but clean typed text is faster and more accurate.

Classic format:

Q1. <Type the question prompt here>
A. <Option A>
B. <Option B>
C. <Option C>
D. <Option D>
ANS: <Single option key such as A, B, C, or D>

Tagged format:

[QUESTION]
<Type the question prompt here>
[OPTION]
A. <Option A>
[OPTION]
B. <Option B>
[OPTION]
C. <Option C>
[OPTION]
D. <Option D>
[ANSWER]
<Single option key such as A, B, C, or D>
[/QUESTION]

Header fields the app can detect:

Title: <Exam title>
Subject: <Subject>
Class: <Class or grade>
Form: <Form>
Teacher: <Teacher name>
School: <School name>
Duration: <Example: 1 hour 30 minutes>
Instructions: <Student instructions>

Notes:
- Use plain option keys such as A, B, C, and D.
- Keep the answer line exact and unambiguous.
- Do not add explanations on the ANS: or [ANSWER] line.
- Remove Word bullets or smart numbering if they change the option keys.
- Save as .docx, .pdf, or .txt before import when possible.
- For scans, use a straight, high-contrast image or PDF page.
`;
import { automaticPackagePassword, isProtectedPackageFile, protectConfigPackage, unprotectConfigPackage } from "./security/package-crypto";
import {
  beginManagedSession,
  configureHostedPartition,
  configureWebContents,
  endManagedSession,
  getActivePackage,
  getActiveSession,
  launchApprovedApplication,
  setNavigationGuard,
  urlAllowedByGuard
} from "./security/session-controller";
import { turnInSubmissionToLms } from "./student-lms-turnin";
import { checkForAppUpdatesAfterStartup, configureAppUpdates } from "./update-service";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const storage = createStorageService(app.getPath("userData"));
const oauthVault = new OAuthVault(join(app.getPath("userData"), "oauth-vault.json"));
const runtimeEnvironment = createRuntimeEnvironment();
const getArgValue = (prefix: string): string | null =>
  process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? null;
const launchRoute = getArgValue("--lockedscreen-route=");
const launchedByNativeHost = process.argv.includes("--lockedscreen-native-hosted=1");
const requiresSingleInstanceLock = !launchedByNativeHost;
const getPackageImportArg = (argv: string[]): string | null =>
  argv.find((entry) => entry.toLowerCase().endsWith(".lscp") && existsSync(entry)) ?? null;

const canOpenExternalHelpUrl = (targetUrl: string): boolean => {
  try {
    const target = new URL(targetUrl);
    const normalWebLink = target.protocol === "https:" || target.protocol === "http:";
    if (!normalWebLink) {
      return false;
    }

    return getActiveSession() ? urlAllowedByGuard(targetUrl) : true;
  } catch {
    return false;
  }
};

const friendlyStudentLmsTurnInError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Student LMS turn-in failed.";
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("access_not_configured") || lowerMessage.includes("institution") || lowerMessage.includes("admin")) {
    return "Google blocked this student account because the school's Google Workspace admin has not allowed Lockedscreen for students. The local exam submission is saved. Ask the Google admin to review/allow the Lockedscreen OAuth app for the student organizational unit, then retry LMS turn-in.";
  }

  if (lowerMessage.includes("closed before it completed") || lowerMessage.includes("access_denied")) {
    return "Student Google sign-in did not finish. The local exam submission is saved. If Google says the institution admin needs to review Lockedscreen, ask the Google Workspace admin to allow the app for students, then retry LMS turn-in.";
  }

  if (lowerMessage.includes("no google classroom submission")) {
    return "No matching Google Classroom submission was found for this student account. The local exam submission is saved. Confirm the student is enrolled in the selected class and that the package is connected to the correct Classroom assignment.";
  }

  return message;
};
const initialPackageImportPath = getPackageImportArg(process.argv);
const readInstalledRole = (): InstalledAppRole => {
  const rolePath = join(process.resourcesPath, "install-role.json");

  try {
    if (!existsSync(rolePath)) {
      return "teacher";
    }

    const parsed = JSON.parse(readFileSync(rolePath, "utf-8")) as { role?: unknown };
    return parsed.role === "student" ? "student" : "teacher";
  } catch {
    return "teacher";
  }
};
const installedRole = readInstalledRole();
const preloadPath = (() => {
  const cjsPath = join(__dirname, "../preload/index.cjs");
  if (existsSync(cjsPath)) {
    return cjsPath;
  }

  const mjsPath = join(__dirname, "../preload/index.mjs");
  if (existsSync(mjsPath)) {
    return mjsPath;
  }

  return join(__dirname, "../preload/index.js");
})();

let mainWindow: BrowserWindow | null = null;
let processMonitorTimer: NodeJS.Timeout | null = null;
let lastProcessAlert = "";
let updateInstallRestarting = false;
let pendingLaunchContext: LaunchContext = {
  route: launchRoute,
  nativeHosted: launchedByNativeHost,
  packageImport: null,
  installedRole
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isExam = (value: unknown): value is Exam =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  Array.isArray(value.questions) &&
  typeof value.mode === "string";

const isSettings = (value: unknown): value is AppSettings =>
  isRecord(value) &&
  typeof value.adminUnlockPin === "string" &&
  typeof value.invigilatorUnlockPin === "string" &&
  typeof value.allowElectronKioskAssist === "boolean" &&
  typeof value.allowNonKioskTestingMode === "boolean" &&
  Array.isArray(value.approvedDomains);

const isSecurityProfile = (value: unknown): value is SecurityProfile =>
  isRecord(value) &&
  typeof value.kioskConfigured === "boolean" &&
  typeof value.kioskMode === "string" &&
  typeof value.dedicatedExamAccount === "boolean" &&
  typeof value.nativeCompanionVerified === "boolean";

const isSession = (value: unknown): value is ExamSession =>
  isRecord(value) &&
  typeof value.examId === "string" &&
  isRecord(value.candidate) &&
  typeof value.startedAt === "string" &&
  typeof value.endsAt === "string" &&
  Array.isArray(value.responses);

const isConfigPackage = (value: unknown): value is ExamConfigPackage =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.examId === "string" &&
  typeof value.label === "string" &&
  isRecord(value.browserPolicy) &&
  isRecord(value.sessionPolicy) &&
  isRecord(value.integrity);

const isResultDestination = (value: unknown): value is ResultDestination =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.label === "string" &&
  typeof value.type === "string" &&
  typeof value.enabled === "boolean" &&
  typeof value.trigger === "string" &&
  typeof value.endpointUrl === "string" &&
  typeof value.authMode === "string" &&
  Array.isArray(value.examIds) &&
  typeof value.includeResponses === "boolean";

const isLmsConnection = (value: unknown): value is LmsConnection =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.label === "string" &&
  typeof value.provider === "string" &&
  typeof value.status === "string" &&
  typeof value.clientId === "string" &&
  typeof value.scope === "string";

const isNavigationGuard = (value: unknown): value is NavigationGuard =>
  isRecord(value) &&
  Array.isArray(value.allowedDomains) &&
  value.allowedDomains.every((domain) => typeof domain === "string") &&
  (value.allowedPrefixes === undefined ||
    (Array.isArray(value.allowedPrefixes) && value.allowedPrefixes.every((prefix) => typeof prefix === "string"))) &&
  (value.startUrl === undefined || typeof value.startUrl === "string");

const isSessionStartRequest = (value: unknown): value is SessionStartRequest =>
  isRecord(value) &&
  typeof value.examId === "string" &&
  typeof value.packageId === "string" &&
  (value.mode === "app" || value.mode === "link");

const isCandidate = (value: unknown): value is Candidate =>
  isRecord(value) && typeof value.id === "string" && typeof value.name === "string";

const isStudentTurnInState = (value: unknown): value is StudentLmsTurnInState =>
  isRecord(value) &&
  typeof value.provider === "string" &&
  typeof value.status === "string";

const isAppUrl = (input: string): boolean => input.startsWith("http://localhost:") || input.startsWith("file://");

const createPackageImportRoute = (): string => `/package-import?open=${Date.now()}`;

const readPackageLaunchInfo = async (filePath: string): Promise<ProtectedPackageLaunchInfo | null> => {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
    if (!isProtectedPackageFile(raw)) {
      return null;
    }

    return {
      filePath,
      label: raw.label,
      examTitle: raw.examTitle,
      passwordHint: raw.passwordHint
    };
  } catch {
    return null;
  }
};

const publishLaunchContext = (nextContext: LaunchContext): void => {
  pendingLaunchContext = nextContext;

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("app:launchContextChanged", pendingLaunchContext);
};

const queuePackageImportLaunch = async (filePath: string): Promise<void> => {
  const packageImport = await readPackageLaunchInfo(filePath);
  if (!packageImport) {
    return;
  }

  publishLaunchContext({
    ...pendingLaunchContext,
    route: createPackageImportRoute(),
    packageImport
  });
};

const recordSecurityEvent = async (
  category: string,
  severity: string,
  message: string,
  details?: string
): Promise<void> => {
  try {
    await storage.appendSecurityLog({
      category: category as never,
      severity: severity as never,
      message,
      details
    });
  } catch {
    // Best-effort logging should not break the shell.
  }
};

const withRuntime = async (operation: Promise<AppStateSnapshot>): Promise<AppStateSnapshot> => {
  const snapshot = await operation;
  return {
    ...snapshot,
    runtime: runtimeEnvironment,
    securityOverview: await buildSecurityOverview(snapshot, runtimeEnvironment, getActivePackage())
  };
};

const syncSubmissionResultsInternal = async (
  submissionId: string,
  options?: { autoOnly?: boolean; packageDestinations?: ResultDestination[]; destinationTypes?: ResultDestination["type"][] }
): Promise<AppStateSnapshot> => {
  const snapshot = await storage.getSnapshot();
  const submission = snapshot.submissions.find((candidate) => candidate.id === submissionId);
  if (!submission) {
    throw new Error("Submission not found.");
  }

  const exam = snapshot.exams.find((candidate) => candidate.id === submission.examId);
  if (!exam) {
    throw new Error("Exam not found for this submission.");
  }

  const destinationMap = new Map<string, ResultDestination>();
  [...snapshot.resultDestinations, ...(options?.packageDestinations ?? [])].forEach((destination) => {
    if (options?.autoOnly && destination.trigger !== "auto-on-submit") {
      return;
    }
    if (options?.destinationTypes && !options.destinationTypes.includes(destination.type)) {
      return;
    }
    destinationMap.set(destination.id, destination);
  });
  const destinations = Array.from(destinationMap.values());

  for (const destination of destinations) {
    let googleAccessToken: string | undefined;
    if (destination.type === "google-sheets") {
      const googleConnection =
        snapshot.lmsConnections.find((connection) => connection.id === destination.connectionId) ??
        snapshot.lmsConnections.find((connection) => connection.provider === "google-classroom" && connection.status === "connected");

      if (googleConnection?.provider === "google-classroom" && googleConnection.status === "connected") {
        try {
          googleAccessToken = await getConnectionAccessToken(
            googleConnection,
            oauthVault,
            snapshot.settings.googleIntegration
          );
        } catch {
          googleAccessToken = undefined;
        }
      }
    }

    const nextState =
      destination.enabled && destination.endpointUrl.trim().length > 0
        ? await syncSubmissionToDestination(destination, exam, submission, { googleAccessToken })
        : createDisabledSyncState(destination, destination.enabled ? "Destination endpoint is empty." : "Destination disabled.");

    await storage.updateSubmissionSyncState(submission.id, nextState);
    await recordSecurityEvent(
      "results",
      nextState.status === "success" ? "info" : nextState.status === "failed" ? "warning" : "info",
      `Result sync ${nextState.status} for "${submission.examTitle}" to ${destination.label}.`,
      nextState.lastError ?? nextState.externalReference
    );
  }

  return withRuntime(storage.getSnapshot());
};

const sanitizePackageResultDestination = (destination: ResultDestination): ResultDestination | null => {
  if (!destination.enabled || destination.trigger !== "auto-on-submit") {
    return null;
  }

  if (destination.type === "google-sheets" && !destination.bridgeEndpointUrl?.trim()) {
    return null;
  }

  if (destination.type === "google-forms-quiz-classroom-sync") {
    return null;
  }

  return {
    ...destination,
    authToken: undefined,
    apiKeyHeader: destination.authMode === "api-key" ? destination.apiKeyHeader : undefined,
    connectionId: undefined,
    endpointUrl: destination.endpointUrl.trim(),
    bridgeEndpointUrl: destination.bridgeEndpointUrl?.trim() || undefined,
    sortByLastName: destination.sortByLastName === true,
    notes: destination.notes?.trim() || undefined
  };
};

const packageResultDestinationsForExport = (
  snapshot: AppStateSnapshot,
  configPackage: ExamConfigPackage
): ResultDestination[] =>
  snapshot.resultDestinations
    .filter((destination) => destination.examIds.length === 0 || destination.examIds.includes(configPackage.examId))
    .map(sanitizePackageResultDestination)
    .filter((destination): destination is ResultDestination => destination !== null);

const normalizeEmailDomain = (value: string): string =>
  value.trim().replace(/^@+/, "").toLowerCase();

const uniqueEmailDomains = (domains: string[]): string[] =>
  Array.from(new Set(domains.map(normalizeEmailDomain).filter(Boolean)));

const domainFromEmail = (email?: string): string | null => {
  const trimmed = email?.trim().toLowerCase();
  const atIndex = trimmed?.lastIndexOf("@") ?? -1;
  return trimmed && atIndex >= 0 ? normalizeEmailDomain(trimmed.slice(atIndex + 1)) : null;
};

const connectedTeacherDomainForPackage = (
  snapshot: AppStateSnapshot,
  configPackage: ExamConfigPackage
): string | null => {
  const binding = configPackage.studentLmsBinding;
  const connection = binding.connectionId
    ? snapshot.lmsConnections.find((candidate) => candidate.id === binding.connectionId)
    : snapshot.lmsConnections.find((candidate) => candidate.provider === binding.provider && candidate.status === "connected");
  return (
    domainFromEmail(connection?.accountEmail) ??
    (binding.provider === "google-classroom" ? domainFromEmail(snapshot.settings.googleIntegration.accountEmail) : null)
  );
};

const applyStudentEmailDomainDefaults = (
  snapshot: AppStateSnapshot,
  configPackage: ExamConfigPackage
): ExamConfigPackage => {
  const explicitDomains = uniqueEmailDomains(configPackage.studentAccessPolicy.allowedEmailDomains ?? []);
  const fallbackDomain = explicitDomains.length === 0 ? connectedTeacherDomainForPackage(snapshot, configPackage) : null;
  return {
    ...configPackage,
    studentAccessPolicy: {
      ...configPackage.studentAccessPolicy,
      allowedEmailDomains: explicitDomains.length > 0 ? explicitDomains : fallbackDomain ? [fallbackDomain] : []
    }
  };
};

const preparePackageForStudentExport = (
  snapshot: AppStateSnapshot,
  configPackage: ExamConfigPackage
): ExamConfigPackage => ({
  ...applyStudentEmailDomainDefaults(snapshot, configPackage),
  passwordHint: undefined,
  resultDestinations: packageResultDestinationsForExport(snapshot, configPackage)
});

const postTurnInGradeSyncDestinations = (configPackage: ExamConfigPackage): ResultDestination[] =>
  configPackage.resultDestinations.filter(
    (destination) =>
      destination.trigger === "auto-on-submit" &&
      destination.type === "google-classroom-grade-sync"
  );

const syncPendingResultsInternal = async (): Promise<AppStateSnapshot> => {
  const snapshot = await storage.getSnapshot();
  const pendingSubmissions = snapshot.submissions.filter((submission) =>
    submission.syncStates.some((state) => state.status === "pending" || state.status === "failed")
  );

  for (const submission of pendingSubmissions) {
    await syncSubmissionResultsInternal(submission.id);
  }

  return withRuntime(storage.getSnapshot());
};

const createWindow = async (): Promise<void> => {
  configureHostedPartition(recordSecurityEvent);

  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#e2e8f0",
    title: "LOCKEDSCREEN",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.on("close", (event) => {
    if (updateInstallRestarting) {
      return;
    }

    if (!getActivePackage()) {
      return;
    }

    event.preventDefault();
    mainWindow?.webContents.send("session:exitBlocked", {
      reason: "The app menu or window close action was used during an active exam."
    });
    void recordSecurityEvent(
      "session",
      "warning",
      "Blocked app close request during an active exam session.",
      "Invigilator PIN is required to release the student."
    );
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });
  configureWebContents(mainWindow.webContents, recordSecurityEvent);

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

const refreshProcessPolicyMonitor = async (): Promise<void> => {
  if (processMonitorTimer) {
    clearInterval(processMonitorTimer);
    processMonitorTimer = null;
  }

  const activePackage = getActivePackage();
  if (!activePackage?.processPolicy.enabled) {
    return;
  }

  const tick = async () => {
    const snapshot = await withRuntime(storage.getSnapshot());
    const disallowed = snapshot.securityOverview?.processSummary.observations
      .filter((entry) => entry.disposition === "disallowed")
      .map((entry) => entry.name)
      .slice(0, 8)
      .join(", ");

    if (disallowed && disallowed !== lastProcessAlert) {
      lastProcessAlert = disallowed;
      await recordSecurityEvent("process", "warning", "Observed disallowed processes during an active exam session.", disallowed);
    }
  };

  processMonitorTimer = setInterval(() => {
    void tick();
  }, Math.max(5, activePackage.processPolicy.pollIntervalSeconds) * 1000);
  void tick();
};

app.on("web-contents-created", (_event, contents) => {
  configureWebContents(contents, recordSecurityEvent);
});

const singleInstanceLock = requiresSingleInstanceLock ? app.requestSingleInstanceLock() : true;

if (requiresSingleInstanceLock && !singleInstanceLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  const packageImportPath = getPackageImportArg(argv);
  if (packageImportPath) {
    void queuePackageImportLaunch(packageImportPath);
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  if (filePath.toLowerCase().endsWith(".lscp") && existsSync(filePath)) {
    void queuePackageImportLaunch(filePath);
  }
});

app.whenReady().then(async () => {
  if (requiresSingleInstanceLock && !singleInstanceLock) {
    return;
  }

  if (initialPackageImportPath) {
    await queuePackageImportLaunch(initialPackageImportPath);
  }

  configureAppUpdates(() => mainWindow, {
    onBeforeInstall: () => {
      updateInstallRestarting = true;
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.setAlwaysOnTop(false);
      mainWindow.setFullScreen(false);
    }
  });

  ipcMain.handle("app:getSnapshot", async () => withRuntime(storage.getSnapshot()));
  ipcMain.handle("app:getLaunchContext", async () => pendingLaunchContext);
  ipcMain.handle("security:refreshOverview", async () => withRuntime(storage.getSnapshot()));

  ipcMain.handle("exam:save", async (_event, exam: unknown) => {
    if (!isExam(exam)) {
      throw new Error("Invalid exam payload.");
    }

    return withRuntime(storage.saveExam(exam));
  });

  ipcMain.handle("exam:delete", async (_event, examId: unknown) => {
    if (typeof examId !== "string") {
      throw new Error("Invalid exam id.");
    }

    return withRuntime(storage.deleteExam(examId));
  });

  ipcMain.handle("exam:hideForStudent", async (_event, payload: unknown) => {
    if (
      !isRecord(payload) ||
      typeof payload.examId !== "string" ||
      typeof payload.candidateId !== "string"
    ) {
      throw new Error("Invalid student exam hide request.");
    }

    return withRuntime(storage.hideExamForStudent(payload.examId, payload.candidateId));
  });

  ipcMain.handle("settings:save", async (_event, settings: unknown) => {
    if (!isSettings(settings)) {
      throw new Error("Invalid settings payload.");
    }

    return withRuntime(storage.saveSettings(settings));
  });

  ipcMain.handle("security:save", async (_event, profile: unknown) => {
    if (!isSecurityProfile(profile)) {
      throw new Error("Invalid security profile payload.");
    }

    return withRuntime(storage.saveSecurityProfile(profile));
  });

  ipcMain.handle("configPackage:save", async (_event, configPackage: unknown) => {
    if (!isConfigPackage(configPackage)) {
      throw new Error("Invalid configuration package payload.");
    }

    const snapshot = await storage.getSnapshot();
    return withRuntime(storage.saveConfigPackage(applyStudentEmailDomainDefaults(snapshot, configPackage)));
  });

  ipcMain.handle("resultsDestination:save", async (_event, destination: unknown) => {
    if (!isResultDestination(destination)) {
      throw new Error("Invalid result destination payload.");
    }

    return withRuntime(storage.saveResultDestination(destination));
  });

  ipcMain.handle("resultsDestinationTemplate:save", async (_event, destination: unknown) => {
    if (!isResultDestination(destination)) {
      throw new Error("Invalid reusable grade-sync setup payload.");
    }

    return withRuntime(storage.saveResultDestinationTemplate(destination));
  });

  ipcMain.handle("lmsConnection:save", async (_event, connection: unknown) => {
    if (!isLmsConnection(connection)) {
      throw new Error("Invalid LMS connection payload.");
    }

    return withRuntime(storage.saveLmsConnection(connection));
  });

  ipcMain.handle("lmsConnection:delete", async (_event, connectionId: unknown) => {
    if (typeof connectionId !== "string") {
      throw new Error("Invalid LMS connection id.");
    }

    await oauthVault.deleteTokens(connectionId);
    return withRuntime(storage.deleteLmsConnection(connectionId));
  });

  ipcMain.handle("lmsConnection:connect", async (_event, connectionId: unknown) => {
    if (typeof connectionId !== "string") {
      throw new Error("Invalid LMS connection id.");
    }

    const snapshot = await storage.getSnapshot();
    const connection = snapshot.lmsConnections.find((candidate) => candidate.id === connectionId);
    if (!connection) {
      throw new Error("LMS connection not found.");
    }

    let connected: LmsConnection;
    try {
      connected = await beginLmsOAuthConnection(connection, oauthVault, snapshot.settings.googleIntegration);
    } catch (error) {
      if (connection.provider === "google-classroom") {
        const lastError = error instanceof Error ? error.message : "Google Classroom sign-in failed.";
        await storage.saveLmsConnection({
          ...connection,
          status: "error",
          lastError,
          updatedAt: new Date().toISOString()
        });
        await storage.saveSettings({
          ...snapshot.settings,
          googleIntegration: {
            ...snapshot.settings.googleIntegration,
            connectionStatus: "error",
            lastError
          }
        });
      }

      throw error;
    }

    if (connected.provider === "google-classroom") {
      const currentSnapshot = await storage.getSnapshot();
      await storage.saveSettings({
        ...currentSnapshot.settings,
        googleIntegration: {
          ...currentSnapshot.settings.googleIntegration,
          enabled: true,
          clientId: connected.clientId,
          requestedScopes: connected.scope.split(/\s+/).filter(Boolean),
          connectionStatus: connected.status,
          accountEmail: connected.accountEmail,
          accountName: connected.accountName,
          lastConnectedAt: connected.lastConnectedAt,
          lastError: connected.lastError
        }
      });
    }
    return withRuntime(storage.saveLmsConnection(connected));
  });

  ipcMain.handle("lmsConnection:signOut", async (_event, payload: unknown) => {
    if (!isRecord(payload) || typeof payload.connectionId !== "string") {
      throw new Error("Invalid LMS sign-out request.");
    }

    const snapshot = await storage.getSnapshot();
    const connection = snapshot.lmsConnections.find((candidate) => candidate.id === payload.connectionId);
    if (!connection) {
      throw new Error("LMS connection not found.");
    }

    const signedOut = await signOutLmsConnection(connection, oauthVault, { revoke: payload.revoke !== false });
    if (signedOut.provider === "google-classroom") {
      const currentSnapshot = await storage.getSnapshot();
      await storage.saveSettings({
        ...currentSnapshot.settings,
        googleIntegration: {
          ...currentSnapshot.settings.googleIntegration,
          connectionStatus: "disconnected",
          accountEmail: "",
          accountName: "",
          lastConnectedAt: undefined,
          lastError: undefined
        }
      });
    }

    return withRuntime(storage.saveLmsConnection(signedOut));
  });

  ipcMain.handle("lmsConnection:clearTokens", async (_event, connectionId: unknown) => {
    if (typeof connectionId !== "string") {
      throw new Error("Invalid LMS connection id.");
    }

    const snapshot = await storage.getSnapshot();
    const connection = snapshot.lmsConnections.find((candidate) => candidate.id === connectionId);
    if (!connection) {
      throw new Error("LMS connection not found.");
    }

    await oauthVault.deleteTokens(connection.id);
    const resetConnection: LmsConnection = {
      ...connection,
      status: "disconnected",
      accountEmail: "",
      accountName: "",
      lastConnectedAt: undefined,
      lastError: undefined,
      updatedAt: new Date().toISOString()
    };

    if (resetConnection.provider === "google-classroom") {
      await storage.saveSettings({
        ...snapshot.settings,
        googleIntegration: {
          ...snapshot.settings.googleIntegration,
          connectionStatus: "disconnected",
          accountEmail: "",
          accountName: "",
          lastConnectedAt: undefined,
          lastError: undefined
        }
      });
    }

    return withRuntime(storage.saveLmsConnection(resetConnection));
  });

  ipcMain.handle("lmsConnection:listCourses", async (_event, connectionId: unknown): Promise<LmsCourse[]> => {
    if (typeof connectionId !== "string") {
      throw new Error("Invalid LMS connection id.");
    }

    const snapshot = await storage.getSnapshot();
    const connection = snapshot.lmsConnections.find((candidate) => candidate.id === connectionId);
    if (!connection) {
      throw new Error("LMS connection not found.");
    }

    return listConnectionCourses(connection, oauthVault, snapshot.settings.googleIntegration);
  });

  ipcMain.handle(
    "lmsConnection:listCourseWork",
    async (_event, payload: unknown): Promise<LmsCourseWork[]> => {
      if (!isRecord(payload) || typeof payload.connectionId !== "string" || typeof payload.courseId !== "string") {
        throw new Error("Invalid LMS coursework lookup payload.");
      }

      const snapshot = await storage.getSnapshot();
      const connection = snapshot.lmsConnections.find((candidate) => candidate.id === payload.connectionId);
      if (!connection) {
        throw new Error("LMS connection not found.");
      }

      return listConnectionCourseWork(connection, payload.courseId, oauthVault, snapshot.settings.googleIntegration);
    }
  );

  ipcMain.handle("lmsConnection:listStudents", async (_event, payload: unknown): Promise<LmsStudent[]> => {
    if (!isRecord(payload) || typeof payload.connectionId !== "string" || typeof payload.courseId !== "string") {
      throw new Error("Invalid LMS student lookup payload.");
    }

    const snapshot = await storage.getSnapshot();
    const connection = snapshot.lmsConnections.find((candidate) => candidate.id === payload.connectionId);
    if (!connection) {
      throw new Error("LMS connection not found.");
    }

    return listConnectionStudents(connection, payload.courseId, oauthVault, snapshot.settings.googleIntegration);
  });

  ipcMain.handle("resultsDestination:delete", async (_event, destinationId: unknown) => {
    if (typeof destinationId !== "string") {
      throw new Error("Invalid result destination id.");
    }

    return withRuntime(storage.deleteResultDestination(destinationId));
  });

  ipcMain.handle("resultsDestinationTemplate:delete", async (_event, destinationId: unknown) => {
    if (typeof destinationId !== "string") {
      throw new Error("Invalid reusable grade-sync setup id.");
    }

    return withRuntime(storage.deleteResultDestinationTemplate(destinationId));
  });

  ipcMain.handle("configPackage:delete", async (_event, packageId: unknown) => {
    if (typeof packageId !== "string") {
      throw new Error("Invalid configuration package id.");
    }

    return withRuntime(storage.deleteConfigPackage(packageId));
  });

  ipcMain.handle("configPackage:duplicate", async (_event, packageId: unknown) => {
    if (typeof packageId !== "string") {
      throw new Error("Invalid configuration package id.");
    }

    return withRuntime(storage.duplicateConfigPackage(packageId));
  });

  ipcMain.handle("configPackage:export", async (_event, payload: unknown) => {
    if (!isRecord(payload) || typeof payload.packageId !== "string") {
      throw new Error("Invalid export request.");
    }

    const snapshot = await storage.getSnapshot();
    const configPackage = snapshot.configPackages.find((candidate) => candidate.id === payload.packageId);
    if (!configPackage) {
      throw new Error("Configuration package not found.");
    }
    const exam = snapshot.exams.find((candidate) => candidate.id === configPackage.examId);
    if (!exam) {
      throw new Error("Linked exam not found for this configuration package.");
    }

    const exportPackage = preparePackageForStudentExport(snapshot, configPackage);
    const protectedFile = protectConfigPackage(exportPackage, automaticPackagePassword, exam);

    const output = await dialog.showSaveDialog({
      defaultPath: `${configPackage.label.replace(/[<>:\"/\\\\|?*]+/g, "-").slice(0, 60) || "lockedscreen-package"}.lscp`,
      filters: [{ name: "Lockedscreen package", extensions: ["lscp"] }]
    });

    if (output.canceled || !output.filePath) {
      return null;
    }

    await writeFile(output.filePath, JSON.stringify(protectedFile, null, 2), "utf-8");
    await recordSecurityEvent("package", "info", `Exported configuration package "${configPackage.label}".`, output.filePath);
    return output.filePath;
  });

  ipcMain.handle("configPackage:publishToClassroom", async (_event, payload: unknown): Promise<{
    snapshot: AppStateSnapshot;
    published: GoogleClassroomPublishResult;
  }> => {
    if (!isRecord(payload) || typeof payload.packageId !== "string") {
      throw new Error("Invalid Classroom publish request.");
    }

    const snapshot = await storage.getSnapshot();
    const configPackage = snapshot.configPackages.find((candidate) => candidate.id === payload.packageId);
    if (!configPackage) {
      throw new Error("Configuration package not found.");
    }

    const binding = configPackage.studentLmsBinding;
    if (!binding.enabled || binding.provider !== "google-classroom" || !binding.connectionId || !binding.courseId) {
      throw new Error("Select a connected Google Classroom class before posting this package.");
    }

    const connection = snapshot.lmsConnections.find((candidate) => candidate.id === binding.connectionId);
    if (!connection || connection.status !== "connected") {
      throw new Error("Reconnect the teacher Google Classroom account before posting this package.");
    }

    const exam = snapshot.exams.find((candidate) => candidate.id === configPackage.examId);
    if (!exam) {
      throw new Error("Linked exam not found for this configuration package.");
    }

    const exportPackage = preparePackageForStudentExport(snapshot, configPackage);
    const protectedFile = protectConfigPackage(exportPackage, automaticPackagePassword, exam);
    const safePackageLabel = configPackage.label.replace(/[<>:\"/\\\\|?*]+/g, "-").slice(0, 60) || "lockedscreen-package";
    const fileName = `${safePackageLabel}.lscp`;
    const totalPoints = exam.questions.reduce((sum, question) => sum + question.points, 0);
    const published = await publishConnectionCourseWork(
      connection,
      {
        courseId: binding.courseId,
        title: exam.title || configPackage.label || "Lockedscreen exam",
        description: [
          "Open the attached Lockedscreen exam package on the school device to begin.",
          "Download the .lscp attachment first, then double-click the downloaded file if Lockedscreen is installed.",
          "Do not open the package in a text editor or Google Drive preview.",
          configPackage.description.trim()
        ].filter(Boolean).join("\n\n"),
        fileName,
        packageJson: JSON.stringify(protectedFile, null, 2),
        maxPoints: totalPoints > 0 ? totalPoints : undefined
      },
      oauthVault,
      snapshot.settings.googleIntegration
    );

    const nextPackage: ExamConfigPackage = {
      ...configPackage,
      studentAccessPolicy: exportPackage.studentAccessPolicy,
      studentLmsBinding: {
        ...binding,
        assignmentId: published.courseWork.id,
        assignmentLabel: published.courseWork.title
      },
      updatedAt: new Date().toISOString()
    };
    const nextSnapshot = await storage.saveConfigPackage(nextPackage);
    await recordSecurityEvent(
      "package",
      "info",
      `Posted configuration package "${configPackage.label}" to Google Classroom.`,
      published.courseWork.alternateLink ?? binding.courseLabel ?? binding.courseId
    );

    return {
      snapshot: await withRuntime(Promise.resolve(nextSnapshot)),
      published
    };
  });

  ipcMain.handle("configPackage:import", async (_event, payload: unknown) => {
    const request = isRecord(payload) ? payload : {};
    if (
      (payload !== undefined && !isRecord(payload)) ||
      (request.filePath !== undefined && typeof request.filePath !== "string")
    ) {
      throw new Error("Invalid import request.");
    }

    const filePath =
      typeof request.filePath === "string"
        ? request.filePath
        : (
            await dialog.showOpenDialog({
              properties: ["openFile"],
              filters: [{ name: "Lockedscreen package", extensions: ["lscp"] }]
            })
          ).filePaths[0];

    if (!filePath) {
      return null;
    }
    const raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
    if (!isProtectedPackageFile(raw)) {
      throw new Error("Invalid protected package file.");
    }

    let imported: { configPackage: ExamConfigPackage; exam: Exam | null };
    try {
      imported = unprotectConfigPackage(raw, automaticPackagePassword);
    } catch (error) {
      if (typeof request.password === "string" && request.password.trim().length > 0) {
        imported = unprotectConfigPackage(raw, request.password);
      } else {
        throw error;
      }
    }
    const nextPackage = {
      ...imported.configPackage,
      passwordHint: undefined
    };
    const snapshot = await withRuntime(
      imported.exam
        ? storage.importExamBundle(imported.exam, nextPackage)
        : storage.saveConfigPackage(nextPackage)
    );
    await recordSecurityEvent("package", "info", `Imported configuration package "${nextPackage.label}".`, filePath);
    return snapshot;
  });

  ipcMain.handle("import:questions", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Supported exam files", extensions: ["txt", "doc", "docx", "pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp"] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const [filePath] = result.filePaths;
    if (!filePath) {
      return null;
    }

    const buffer = await readFile(filePath);
    const extracted = await extractExamDocumentText(filePath, buffer);
    const preview = parseExamDocument(filePath, extracted.text);
    return {
      ...preview,
      extraction: extracted.extraction
    };
  });

  ipcMain.handle("import:exportQuestionTemplate", async () => {
    const output = await dialog.showSaveDialog({
      defaultPath: "lockedscreen-question-template.txt",
      filters: [{ name: "Text file", extensions: ["txt"] }]
    });

    if (output.canceled || !output.filePath) {
      return null;
    }

    await writeFile(output.filePath, questionAuthoringTemplate, "utf-8");
    return output.filePath;
  });

  ipcMain.handle("results:exportCsv", async (_event, examId?: string) => {
    const csv = await storage.exportCsv(examId);
    const output = await dialog.showSaveDialog({
      defaultPath: `lockedscreen-results-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });

    if (output.canceled || !output.filePath) {
      return null;
    }

    await writeFile(output.filePath, csv, "utf-8");
    return output.filePath;
  });

  ipcMain.handle("results:syncSubmission", async (_event, submissionId: unknown) => {
    if (typeof submissionId !== "string") {
      throw new Error("Invalid submission id.");
    }

    return syncSubmissionResultsInternal(submissionId);
  });

  ipcMain.handle("results:syncPending", async () => syncPendingResultsInternal());

  ipcMain.handle("window:captureScreenshot", async () => {
    if (!mainWindow) {
      return null;
    }

    const image = await mainWindow.webContents.capturePage();
    const timestamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
    const output = await dialog.showSaveDialog({
      defaultPath: `lockedscreen-screenshot-${timestamp}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }]
    });

    if (output.canceled || !output.filePath) {
      return null;
    }

    await writeFile(output.filePath, image.toPNG());
    await recordSecurityEvent("session", "info", "Saved an in-app screenshot from the active session.", output.filePath);
    return output.filePath;
  });

  ipcMain.handle("session:begin", async (_event, request: unknown) => {
    if (!isSessionStartRequest(request)) {
      throw new Error("Invalid session start request.");
    }

    const snapshot = await storage.getSnapshot();
    const configPackage = snapshot.configPackages.find((candidate) => candidate.id === request.packageId);
    if (!configPackage) {
      throw new Error("Configuration package not found.");
    }

    const windowsFullKioskPackage = process.platform === "win32" && configPackage.securityMode === "full-kiosk";
    const needsNativeCompanion =
      !launchedByNativeHost &&
      (windowsFullKioskPackage ||
        ((configPackage.securityMode === "full-kiosk" || request.mode === "app") &&
          nativeCompanionRequired(snapshot.securityProfile)));

    if (needsNativeCompanion) {
      await beginNativeLockdownSession(request, configPackage, recordSecurityEvent);
    }

    try {
      await beginManagedSession(mainWindow, request, configPackage, recordSecurityEvent);
    } catch (error) {
      if (needsNativeCompanion) {
        await endNativeLockdownSession(recordSecurityEvent);
      }
      throw error;
    }

    await refreshProcessPolicyMonitor();
    return withRuntime(storage.getSnapshot());
  });

  ipcMain.handle("session:launchAlternateDesktop", async (_event, payload: unknown) => {
    if (!isRecord(payload) || typeof payload.examId !== "string" || !isCandidate(payload.candidate)) {
      throw new Error("Invalid alternate desktop launch payload.");
    }

    const snapshot = await storage.getSnapshot();
    const exam = snapshot.exams.find((candidate) => candidate.id === payload.examId);
    if (!exam) {
      throw new Error("Exam not found.");
    }

    const configPackage =
      snapshot.configPackages.find((candidate) => candidate.examId === payload.examId && candidate.status !== "archived") ??
      snapshot.configPackages.find((candidate) => candidate.examId === payload.examId);

    if (!configPackage) {
      throw new Error("Configuration package not found.");
    }

    if (configPackage.securityMode !== "full-kiosk") {
      return false;
    }

    if (!app.isPackaged) {
      return false;
    }

    await launchAlternateDesktopExamShell(
      {
        examId: exam.id,
        examMode: exam.mode,
        packageId: configPackage.id,
        route:
          (exam.mode === "link" ? `/link/${exam.id}` : `/session/${exam.id}`) +
          `?candidateName=${encodeURIComponent(payload.candidate.name)}&candidateId=${encodeURIComponent(payload.candidate.id)}`,
        shellExecutablePath: process.execPath,
        shellArgs: [
          "--lockedscreen-route=" +
            (exam.mode === "link" ? `/link/${exam.id}` : `/session/${exam.id}`) +
            `?candidateName=${encodeURIComponent(payload.candidate.name)}&candidateId=${encodeURIComponent(payload.candidate.id)}`,
          "--lockedscreen-native-hosted=1"
        ]
      },
      configPackage,
      recordSecurityEvent
    );

    return true;
  });

  ipcMain.handle("session:end", async (_event, reason: unknown) => {
    await endManagedSession(mainWindow, typeof reason === "string" ? reason : "Session closed", recordSecurityEvent);
    await endNativeLockdownSession(recordSecurityEvent);
    if (processMonitorTimer) {
      clearInterval(processMonitorTimer);
      processMonitorTimer = null;
    }
    return withRuntime(storage.getSnapshot());
  });

  ipcMain.handle("applications:launch", async (_event, payload: unknown) => {
    if (!isRecord(payload) || typeof payload.packageId !== "string" || typeof payload.appId !== "string") {
      throw new Error("Invalid application launch payload.");
    }

    const snapshot = await storage.getSnapshot();
    const configPackage = snapshot.configPackages.find((candidate) => candidate.id === payload.packageId);
    if (!configPackage) {
      throw new Error("Configuration package not found.");
    }

    await launchApprovedApplication(configPackage, payload.appId, recordSecurityEvent);
    return withRuntime(storage.getSnapshot());
  });

  ipcMain.handle("exam:submit", async (_event, payload: unknown) => {
    if (!isRecord(payload) || !isExam(payload.exam) || !isSession(payload.session)) {
      throw new Error("Invalid submission payload.");
    }

    const result = await storage.recordSubmission(payload.exam, payload.session);
    const activePackage = getActivePackage();
    let snapshot = await storage.getSnapshot();

    if (activePackage?.studentLmsBinding.enabled) {
      const pendingTurnInState: StudentLmsTurnInState = {
        provider: activePackage.studentLmsBinding.provider,
        status: "pending",
        lastAttemptAt: new Date().toISOString(),
        gradeSyncStatus: activePackage.studentLmsBinding.provider === "google-classroom" ? "pending" : undefined
      };
      snapshot = await storage.updateSubmissionStudentLmsTurnIn(result.id, pendingTurnInState);
      result.studentLmsTurnIn = pendingTurnInState;
    }

    const packageAutoDestinations = activePackage?.resultDestinations.filter((destination) => destination.trigger === "auto-on-submit") ?? [];
    for (const destination of packageAutoDestinations) {
      const pendingSyncState = {
        destinationId: destination.id,
        destinationLabel: destination.label,
        destinationType: destination.type,
        status: destination.enabled ? "pending" : "disabled"
      } as const;
      snapshot = await storage.updateSubmissionSyncState(result.id, pendingSyncState);
      result.syncStates = [
        ...result.syncStates.filter((state) => state.destinationId !== destination.id),
        pendingSyncState
      ];
    }

    void syncSubmissionResultsInternal(result.id, {
      autoOnly: true,
      packageDestinations: packageAutoDestinations
    }).catch(() => {
      // Best-effort auto-sync must never block local submission completion.
    });
    return {
      result,
      snapshot: await withRuntime(Promise.resolve(snapshot))
    };
  });

  ipcMain.handle("studentLms:turnIn", async (_event, payload: unknown) => {
    if (!isRecord(payload) || typeof payload.submissionId !== "string" || typeof payload.packageId !== "string") {
      throw new Error("Invalid student LMS turn-in payload.");
    }

    const snapshot = await storage.getSnapshot();
    const submission = snapshot.submissions.find((candidate) => candidate.id === payload.submissionId);
    if (!submission) {
      throw new Error("Submission not found.");
    }

    const configPackage = snapshot.configPackages.find((candidate) => candidate.id === payload.packageId);
    if (!configPackage) {
      throw new Error("Configuration package not found.");
    }

    const exam = snapshot.exams.find((candidate) => candidate.id === configPackage.examId);
    if (!exam) {
      throw new Error("Exam not found for this package.");
    }

    try {
      let teacherAccessToken: string | undefined;
      const binding = configPackage.studentLmsBinding;
      if (binding.provider === "google-classroom" && binding.connectionId) {
        const teacherConnection = snapshot.lmsConnections.find((candidate) => candidate.id === binding.connectionId);
        if (teacherConnection?.status === "connected") {
          try {
            teacherAccessToken = await getConnectionAccessToken(teacherConnection, oauthVault, snapshot.settings.googleIntegration);
          } catch {
            teacherAccessToken = undefined;
          }
        }
      }

      const state = await turnInSubmissionToLms(mainWindow, configPackage, exam, submission, { teacherAccessToken });
      const nextSnapshot = await storage.updateSubmissionStudentLmsTurnIn(submission.id, state);
      const updatedSubmission = nextSnapshot.submissions.find((candidate) => candidate.id === submission.id);
      if (!updatedSubmission) {
        throw new Error("Updated submission not found.");
      }

      const postTurnInDestinations = postTurnInGradeSyncDestinations(configPackage);
      if (postTurnInDestinations.length > 0) {
        void syncSubmissionResultsInternal(submission.id, {
          autoOnly: true,
          packageDestinations: postTurnInDestinations,
          destinationTypes: ["google-classroom-grade-sync"]
        }).catch((syncError) => {
          void recordSecurityEvent(
            "results",
            "warning",
            `Post-turn-in grade sync failed for "${submission.examTitle}".`,
            syncError instanceof Error ? syncError.message : "Post-turn-in grade sync failed."
          );
        });
      }

      await recordSecurityEvent(
        "results",
        "info",
        `Student LMS turn-in succeeded for "${submission.examTitle}".`,
        state.externalReference
      );

      return {
        state,
        submission: updatedSubmission,
        snapshot: await withRuntime(Promise.resolve(nextSnapshot))
      };
    } catch (error) {
      const failedState: StudentLmsTurnInState = {
        provider: configPackage.studentLmsBinding.provider,
        status: "failed",
        lastAttemptAt: new Date().toISOString(),
        lastError: friendlyStudentLmsTurnInError(error)
      };
      const nextSnapshot = await storage.updateSubmissionStudentLmsTurnIn(submission.id, failedState);
      const updatedSubmission = nextSnapshot.submissions.find((candidate) => candidate.id === submission.id);
      await recordSecurityEvent(
        "results",
        "warning",
        `Student LMS turn-in failed for "${submission.examTitle}".`,
        failedState.lastError
      );

      return {
        state: failedState,
        submission: updatedSubmission ?? { ...submission, studentLmsTurnIn: failedState },
        snapshot: await withRuntime(Promise.resolve(nextSnapshot))
      };
    }
  });

  ipcMain.handle("window:setAssistKiosk", async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean" || !mainWindow) {
      return;
    }

    mainWindow.setAlwaysOnTop(enabled, "screen-saver");
    mainWindow.setFullScreen(enabled);
  });

  ipcMain.handle("window:setNavigationGuard", async (_event, guard: unknown) => {
    if (guard === null) {
      setNavigationGuard(null);
      return;
    }

    if (!isNavigationGuard(guard)) {
      throw new Error("Invalid navigation guard.");
    }

    setNavigationGuard(guard);
  });

  ipcMain.handle("shell:openExternal", async (_event, url: unknown) => {
    if (typeof url !== "string" || !canOpenExternalHelpUrl(url)) {
      throw new Error("This link cannot be opened right now.");
    }

    await shell.openExternal(url);
  });

  await createWindow();
  checkForAppUpdatesAfterStartup();
  await recordSecurityEvent("kiosk", "info", "Lockedscreen kiosk component initialized.", `Platform ${runtimeEnvironment.platform}`);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
