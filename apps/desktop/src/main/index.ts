import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

import { extractTextFromBuffer, parseExamDocument } from "@lockedscreen/parser";
import type {
  Candidate,
  AppSettings,
  AppStateSnapshot,
  Exam,
  ExamConfigPackage,
  ExamSession,
  LaunchContext,
  LmsConnection,
  LmsCourse,
  LmsCourseWork,
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

import { beginLmsOAuthConnection, listConnectionCourses, listConnectionCourseWork } from "./lms-oauth";
import { OAuthVault } from "./oauth-vault";
import { createDisabledSyncState, syncSubmissionToDestination } from "./results-sync";
import { buildSecurityOverview, createRuntimeEnvironment } from "./security/diagnostics";
import {
  beginNativeLockdownSession,
  endNativeLockdownSession,
  launchAlternateDesktopExamShell,
  nativeCompanionRequired
} from "./security/native-security";
import { isProtectedPackageFile, protectConfigPackage, unprotectConfigPackage } from "./security/package-crypto";
import {
  beginManagedSession,
  configureHostedPartition,
  configureWebContents,
  endManagedSession,
  getActivePackage,
  launchApprovedApplication,
  setNavigationGuard,
  urlAllowedByGuard
} from "./security/session-controller";
import { turnInSubmissionToLms } from "./student-lms-turnin";

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
const initialPackageImportPath = getPackageImportArg(process.argv);
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
let pendingLaunchContext: LaunchContext = {
  route: launchRoute,
  nativeHosted: launchedByNativeHost,
  packageImport: null
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

const createPackageImportRoute = (): string => `/teacher/package-import?open=${Date.now()}`;

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
  options?: { autoOnly?: boolean }
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

  const destinations = snapshot.resultDestinations.filter((destination) =>
    options?.autoOnly ? destination.trigger === "auto-on-submit" : true
  );

  for (const destination of destinations) {
    const nextState =
      destination.enabled && destination.endpointUrl.trim().length > 0
        ? await syncSubmissionToDestination(destination, exam, submission)
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

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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

    return withRuntime(storage.saveConfigPackage(configPackage));
  });

  ipcMain.handle("resultsDestination:save", async (_event, destination: unknown) => {
    if (!isResultDestination(destination)) {
      throw new Error("Invalid result destination payload.");
    }

    return withRuntime(storage.saveResultDestination(destination));
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

    const connected = await beginLmsOAuthConnection(connection, oauthVault);
    return withRuntime(storage.saveLmsConnection(connected));
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

    return listConnectionCourses(connection, oauthVault);
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

      return listConnectionCourseWork(connection, payload.courseId, oauthVault);
    }
  );

  ipcMain.handle("resultsDestination:delete", async (_event, destinationId: unknown) => {
    if (typeof destinationId !== "string") {
      throw new Error("Invalid result destination id.");
    }

    return withRuntime(storage.deleteResultDestination(destinationId));
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
    if (!isRecord(payload) || typeof payload.packageId !== "string" || typeof payload.password !== "string") {
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

    const protectedFile = protectConfigPackage(
      {
        ...configPackage,
        passwordHint: typeof payload.passwordHint === "string" ? payload.passwordHint : configPackage.passwordHint
      },
      payload.password,
      exam
    );

    const output = await dialog.showSaveDialog({
      defaultPath: `${configPackage.label.replace(/[<>:\"/\\\\|?*]+/g, "-").slice(0, 60) || "lockedscreen-package"}.lscp`,
      filters: [{ name: "Lockedscreen package", extensions: ["lscp"] }]
    });

    if (output.canceled || !output.filePath) {
      return null;
    }

    await writeFile(output.filePath, JSON.stringify(protectedFile, null, 2), "utf-8");
    await recordSecurityEvent("package", "info", `Exported protected configuration package "${configPackage.label}".`, output.filePath);
    return output.filePath;
  });

  ipcMain.handle("configPackage:import", async (_event, payload: unknown) => {
    if (
      !isRecord(payload) ||
      typeof payload.password !== "string" ||
      (payload.filePath !== undefined && typeof payload.filePath !== "string")
    ) {
      throw new Error("Invalid import request.");
    }

    const filePath =
      typeof payload.filePath === "string"
        ? payload.filePath
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

    const imported = unprotectConfigPackage(raw, payload.password);
    const nextPackage = {
      ...imported.configPackage,
      passwordHint:
        typeof payload.passwordHint === "string" ? payload.passwordHint : imported.configPackage.passwordHint
    };
    const snapshot = await withRuntime(
      imported.exam
        ? storage.importExamBundle(imported.exam, nextPackage)
        : storage.saveConfigPackage(nextPackage)
    );
    await recordSecurityEvent("package", "info", `Imported protected configuration package "${nextPackage.label}".`, filePath);
    return snapshot;
  });

  ipcMain.handle("import:questions", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Supported exam files", extensions: ["txt", "doc", "docx", "pdf"] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const [filePath] = result.filePaths;
    if (!filePath) {
      return null;
    }

    const buffer = await readFile(filePath);
    const text = await extractTextFromBuffer(filePath, buffer);
    return parseExamDocument(filePath, text);
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

    const needsNativeCompanion =
      !launchedByNativeHost &&
      configPackage.securityMode === "full-kiosk" &&
      nativeCompanionRequired(snapshot.securityProfile);

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

    if (configPackage.securityMode !== "full-kiosk" || !nativeCompanionRequired(snapshot.securityProfile)) {
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
        lastAttemptAt: new Date().toISOString()
      };
      snapshot = await storage.updateSubmissionStudentLmsTurnIn(result.id, pendingTurnInState);
      result.studentLmsTurnIn = pendingTurnInState;
    }

    void syncSubmissionResultsInternal(result.id, { autoOnly: true }).catch(() => {
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
      const state = await turnInSubmissionToLms(mainWindow, configPackage, exam, submission);
      const nextSnapshot = await storage.updateSubmissionStudentLmsTurnIn(submission.id, state);
      const updatedSubmission = nextSnapshot.submissions.find((candidate) => candidate.id === submission.id);
      if (!updatedSubmission) {
        throw new Error("Updated submission not found.");
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
        lastError: error instanceof Error ? error.message : "Student LMS turn-in failed."
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
    if (typeof url === "string" && urlAllowedByGuard(url)) {
      await shell.openExternal(url);
    }
  });

  await createWindow();
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
