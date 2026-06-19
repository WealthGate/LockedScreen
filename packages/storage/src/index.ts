import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { scoreSubmission } from "@lockedscreen/exam-engine";
import type {
  AppSettings,
  AppStateSnapshot,
  EnforcementLevel,
  EnvironmentPolicy,
  Exam,
  ExamConfigPackage,
  ExamSession,
  ExternalDeliveryMode,
  GoogleIntegrationSettings,
  LmsConnection,
  ProcessPolicy,
  ResultDestination,
  SchoolBranding,
  SecurityLogCategory,
  SecurityLogEntry,
  SecurityLogSeverity,
  SecurityProfile,
  StudentAccessPolicy,
  StudentExamState,
  StudentLmsBinding,
  StudentLmsProviderType,
  StudentLmsTurnInState,
  SubmissionSyncState,
  SubmissionResult,
  TeacherOptions
} from "@lockedscreen/shared-types";

const defaultGoogleClassroomScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets"
];

const defaultGoogleIntegration = (): GoogleIntegrationSettings => ({
  enabled: false,
  clientId: "",
  clientSecret: "",
  requestedScopes: [...defaultGoogleClassroomScopes],
  connectionStatus: "disconnected",
  accountEmail: "",
  accountName: "",
  lastConnectedAt: undefined,
  lastError: undefined
});

const defaultSettings: AppSettings = {
  adminUnlockPin: "2468",
  invigilatorUnlockPin: "2468",
  defaultTheme: "system",
  allowElectronKioskAssist: true,
  allowNonKioskTestingMode: false,
  approvedDomains: ["docs.google.com", "classroom.google.com", "forms.gle", "app.formative.com"],
  defaultGoogleSheetsSyncEndpoint: "",
  googleIntegration: defaultGoogleIntegration()
};

const defaultSecurityProfile: SecurityProfile = {
  kioskConfigured: false,
  kioskMode: "not-configured",
  dedicatedExamAccount: false,
  nativeCompanionVerified: false
};

const defaultTeacherOptions = (): TeacherOptions => ({
  showSchoolBranding: true,
  showCandidateId: true,
  showTimer: true,
  showScoreAfterSubmit: false,
  supportMessage: "Contact the invigilator if you need help during the session."
});

const defaultStudentAccessPolicy = (): StudentAccessPolicy => ({
  assignedClassNames: [],
  assignedCandidateIds: [],
  availableFrom: undefined,
  availableUntil: undefined,
  allowStudentDeletionAfterCompletion: true,
  startCodeHash: undefined,
  startCodeSalt: undefined,
  startCodeHint: undefined
});

const defaultEnvironmentPolicy = (): EnvironmentPolicy => ({
  virtualMachine: { enabled: true, required: false, enforcement: "advisory" },
  multipleDisplays: { enabled: true, required: true, enforcement: "os-kiosk-enforced" },
  remoteSession: { enabled: true, required: true, enforcement: "advisory" },
  screenSharing: { enabled: true, required: false, enforcement: "advisory" },
  screenCapture: { enabled: true, required: false, enforcement: "os-kiosk-enforced" },
  printing: { enabled: true, required: true, enforcement: "app-enforced" },
  clipboard: { enabled: true, required: true, enforcement: "app-enforced" },
  sleepIdle: { enabled: true, required: false, enforcement: "advisory" }
});

const defaultProcessPolicy = (): ProcessPolicy => ({
  enabled: true,
  pollIntervalSeconds: 15,
  allowedProcessNames: ["lockedscreen.exe", "electron.exe", "webview2manager.exe"],
  disallowedProcessNames: ["teams.exe", "slack.exe", "discord.exe", "obs64.exe", "zoom.exe"],
  violationAction: "review-recommended"
});

const packageChecksumInput = (candidate: ExamConfigPackage): string =>
  JSON.stringify({
    ...candidate,
    integrity: {
      algorithm: candidate.integrity.algorithm,
      checksum: ""
    }
  });

export const calculateConfigPackageChecksum = (candidate: ExamConfigPackage): string =>
  createHash("sha256").update(packageChecksumInput(candidate)).digest("hex");

export const withStampedIntegrity = (candidate: ExamConfigPackage): ExamConfigPackage => {
  const checksum = calculateConfigPackageChecksum(candidate);
  return {
    ...candidate,
    integrity: {
      ...candidate.integrity,
      algorithm: "sha256",
      checksum
    }
  };
};

const defaultBlockedShortcuts = (enforcement: EnforcementLevel): string[] =>
  enforcement === "app-enforced"
    ? ["F5", "Ctrl+R", "Ctrl+W", "Ctrl+P", "Alt+Left", "Alt+Right", "Ctrl+C", "Ctrl+V"]
    : ["Windows-key paths require a native Windows lockdown companion or official Windows kiosk deployment"];

const defaultBranding = (exam: Exam): SchoolBranding => ({
  schoolName: exam.branding.schoolName,
  logoDataUrl: exam.branding.logoDataUrl,
  accentColor: exam.branding.accentColor
});

const defaultStudentLmsBinding = (): StudentLmsBinding => ({
  enabled: false,
  provider: "google-classroom",
  connectionId: undefined,
  clientId: "",
  clientSecret: undefined,
  tenantId: "",
  scope: "",
  courseId: "",
  courseLabel: "",
  assignmentId: "",
  assignmentLabel: ""
});

const defaultStudentLmsScopes = (provider: StudentLmsProviderType): string =>
  provider === "google-classroom"
    ? [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/classroom.coursework.me",
        "https://www.googleapis.com/auth/drive.file"
      ].join(" ")
    : ["offline_access", "openid", "profile", "User.Read", "EduAssignments.ReadWrite", "Files.ReadWrite"].join(" ");

const normalizeResultDestination = (destination: ResultDestination): ResultDestination => ({
  ...destination,
  authMode: destination.authMode ?? "none",
  examIds: Array.isArray(destination.examIds) ? destination.examIds : [],
  connectionId: destination.connectionId?.trim() || undefined,
  assignmentId: destination.assignmentId?.trim() || undefined,
  assignmentLabel: destination.assignmentLabel?.trim() || undefined,
  bridgeEndpointUrl: destination.bridgeEndpointUrl?.trim() || undefined,
  sortByLastName: destination.sortByLastName === true,
  includeResponses: destination.includeResponses ?? true
});

const normalizeExam = (exam: Exam): Exam => ({
  ...exam,
  form: exam.form ?? ""
});

const normalizeStudentLmsBinding = (binding: StudentLmsBinding | null | undefined): StudentLmsBinding => ({
  ...defaultStudentLmsBinding(),
  ...(binding ?? {}),
  clientId: binding?.clientId?.trim() ?? "",
  clientSecret: binding?.clientSecret?.trim() || undefined,
  scope: defaultStudentLmsScopes(binding?.provider ?? "google-classroom"),
  courseId: binding?.courseId ?? "",
  assignmentId: binding?.assignmentId ?? ""
});

const normalizeExternalDeliveryMode = (mode: unknown): ExternalDeliveryMode =>
  mode === "lockdown-only" || mode === "integrated" ? mode : "integrated";

const disableStudentLmsBinding = (binding: StudentLmsBinding): StudentLmsBinding => ({
  ...binding,
  enabled: false,
  connectionId: undefined,
  clientId: "",
  clientSecret: undefined,
  tenantId: binding.provider === "microsoft-365" ? "common" : "",
  scope: "",
  courseId: "",
  courseLabel: "",
  assignmentId: "",
  assignmentLabel: ""
});

const normalizeStudentAccessPolicy = (policy: StudentAccessPolicy | null | undefined): StudentAccessPolicy => ({
  ...defaultStudentAccessPolicy(),
  ...(policy ?? {}),
  assignedClassNames: Array.isArray(policy?.assignedClassNames) ? policy.assignedClassNames : [],
  assignedCandidateIds: Array.isArray(policy?.assignedCandidateIds) ? policy.assignedCandidateIds : [],
  startCodeHash: policy?.startCodeHash?.trim() || undefined,
  startCodeSalt: policy?.startCodeSalt?.trim() || undefined,
  startCodeHint: policy?.startCodeHint?.trim() || undefined
});

const normalizeConfigPackage = (configPackage: ExamConfigPackage): ExamConfigPackage => {
  const externalDeliveryMode = normalizeExternalDeliveryMode(configPackage.externalDeliveryMode);
  const studentLmsBinding = normalizeStudentLmsBinding(configPackage.studentLmsBinding);
  const resultDestinations = Array.isArray(configPackage.resultDestinations)
    ? configPackage.resultDestinations.map(normalizeResultDestination)
    : [];
  const normalized: ExamConfigPackage = {
    ...configPackage,
    externalDeliveryMode,
    teacherOptions: {
      ...defaultTeacherOptions(),
      ...(configPackage.teacherOptions ?? {})
    },
    studentLmsBinding: externalDeliveryMode === "lockdown-only" ? disableStudentLmsBinding(studentLmsBinding) : studentLmsBinding,
    resultDestinations: externalDeliveryMode === "lockdown-only" ? [] : resultDestinations,
    studentAccessPolicy: normalizeStudentAccessPolicy(configPackage.studentAccessPolicy)
  };

  const storedChecksum = configPackage.integrity?.checksum;
  const rawPackageWasValid = Boolean(storedChecksum) && calculateConfigPackageChecksum(configPackage) === storedChecksum;
  const normalizedPackageIsValid = Boolean(storedChecksum) && calculateConfigPackageChecksum(normalized) === storedChecksum;

  // App updates may add default package fields during normalization. If the stored package was valid
  // before those defaults were added, restamp the normalized package instead of showing a false
  // integrity failure after upgrade.
  return rawPackageWasValid && !normalizedPackageIsValid ? withStampedIntegrity(normalized) : normalized;
};

const normalizeLmsConnection = (connection: LmsConnection): LmsConnection => ({
  ...connection,
  clientSecret: connection.clientSecret?.trim() || undefined,
  scope: connection.scope ?? "",
  status: connection.status ?? "disconnected"
});

const normalizeGoogleIntegration = (
  settings: Partial<GoogleIntegrationSettings> | null | undefined
): GoogleIntegrationSettings => {
  const requestedScopes = Array.isArray(settings?.requestedScopes)
    ? settings.requestedScopes.map((scope) => scope.trim()).filter(Boolean)
    : [];
  const mergedScopes = Array.from(new Set([...(requestedScopes.length > 0 ? requestedScopes : []), ...defaultGoogleClassroomScopes]));

  return {
    ...defaultGoogleIntegration(),
    ...(settings ?? {}),
    enabled: settings?.enabled === true,
    clientId: settings?.clientId?.trim() ?? "",
    clientSecret: settings?.clientSecret?.trim() ?? "",
    requestedScopes: mergedScopes,
    connectionStatus:
      settings?.connectionStatus === "connected" || settings?.connectionStatus === "error"
        ? settings.connectionStatus
        : "disconnected",
    accountEmail: settings?.accountEmail?.trim() ?? "",
    accountName: settings?.accountName?.trim() ?? ""
  };
};

const buildSubmissionSyncStates = (destinations: ResultDestination[]): SubmissionSyncState[] =>
  destinations.map((destination) => ({
    destinationId: destination.id,
    destinationLabel: destination.label,
    destinationType: destination.type,
    status: destination.enabled ? "pending" : "disabled"
  }));

const normalizeSubmission = (submission: SubmissionResult, destinations: ResultDestination[]): SubmissionResult => {
  const effectiveDestinations = submission.externalDeliveryMode === "lockdown-only" ? [] : destinations;
  const existingStates = new Map(submission.syncStates?.map((state) => [state.destinationId, state]) ?? []);
  const mergedStates = effectiveDestinations.map((destination) => {
    const existing = existingStates.get(destination.id);
    if (existing) {
      return {
        ...existing,
        destinationLabel: destination.label,
        destinationType: destination.type,
        status: destination.enabled ? existing.status : "disabled"
      };
    }

    return {
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationType: destination.type,
      status: destination.enabled ? "pending" : "disabled"
    } satisfies SubmissionSyncState;
  });

  return {
    ...submission,
    candidateClassName: submission.candidateClassName,
    syncStates: mergedStates,
    studentLmsTurnIn: submission.studentLmsTurnIn
  };
};

export const createConfigPackageFromExam = (exam: Exam): ExamConfigPackage => {
  const now = new Date().toISOString();
  const securityMode = "full-kiosk";
  const allowedDomains =
    exam.mode === "link" ? exam.linkConfig?.allowedDomains ?? [] : [];
  const startUrl = exam.mode === "link" ? exam.linkConfig?.url : undefined;
  const config: ExamConfigPackage = {
    id: randomUUID(),
    examId: exam.id,
    label: `${exam.title || "Untitled exam"} package`,
    description:
      exam.mode === "link"
        ? "Controlled hosted-exam package with URL filtering and kiosk guidance."
        : "Native exam package with local runtime and full-kiosk lockdown defaults.",
    status: "active",
    packageVersion: 1,
    externalDeliveryMode: "lockdown-only",
    sourceMode: exam.mode,
    securityMode,
    browserPolicy: {
      displayMode: exam.mode === "link" ? "immersive" : "focus",
      showReloadButton: false,
      showBackToStartButton: exam.mode === "link",
      protectedBackToStart: true,
      showToolbarHints: false,
      allowContextMenu: false,
      restrictNavigationChrome: true,
      preserveQueryParameters: true,
      startUrl,
      allowedDomains,
      urlRules: startUrl
        ? [
            {
              id: randomUUID(),
              label: "Primary exam origin",
              pattern: new URL(startUrl).origin,
              kind: "prefix",
              role: "start",
              allowSubdomains: false
            }
          ]
        : []
    },
    sessionPolicy: {
      clearSessionOnStart: exam.mode === "link",
      clearSessionOnEnd: exam.mode === "link",
      restartInsteadOfQuit: false,
      askBeforeQuit: true,
      allowExitAfterSubmit: false,
      timeoutAction: "submit"
    },
    allowedApplications: [],
    processPolicy: defaultProcessPolicy(),
    environmentPolicy: defaultEnvironmentPolicy(),
    clipboardPolicy: {
      mode: "block-copy",
      enforcement: "app-enforced"
    },
    capturePolicy: {
      mode: "allow-in-app-only",
      enforcement: "advisory"
    },
    printPolicy: {
      mode: "block",
      enforcement: "app-enforced"
    },
    keyRestrictionPolicy: {
      enforcement: "app-enforced",
      metadata:
        "Lockedscreen blocks browser-level shortcuts in Restricted App Mode. Windows key paths require a native Windows lockdown companion or official Windows kiosk deployment.",
      blockedShortcuts: defaultBlockedShortcuts("app-enforced")
    },
    teacherOptions: defaultTeacherOptions(),
    studentAccessPolicy: defaultStudentAccessPolicy(),
    quitUnlockPolicy: {
      requireInvigilatorPin: true,
      allowRestartSession: true,
      askBeforeQuit: true
    },
    branding: defaultBranding(exam),
    studentLmsBinding: defaultStudentLmsBinding(),
    resultDestinations: [],
    createdAt: now,
    updatedAt: now,
    integrity: {
      algorithm: "sha256",
      checksum: ""
    }
  };

  return withStampedIntegrity(config);
};

const logEntry = (
  category: SecurityLogCategory,
  severity: SecurityLogSeverity,
  message: string,
  details?: string
): SecurityLogEntry => ({
  id: randomUUID(),
  timestamp: new Date().toISOString(),
  category,
  severity,
  message,
  details
});

const sampleExam = (): Exam => {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    mode: "app",
    title: "Year 10 Chemistry Midterm",
    subject: "Chemistry",
    className: "Year 10",
    form: "A",
    instructions:
      "Read each question carefully. Select one answer for each item. Use the flag action for questions you want to revisit before submitting.",
    durationMinutes: 45,
    branding: {
      schoolName: "Northfield Academy",
      accentColor: "#0f766e"
    },
    appearance: {
      theme: "system",
      headerLayout: "split",
      fontScale: 1,
      density: "comfortable"
    },
    questions: [
      {
        id: randomUUID(),
        type: "multiple-choice",
        prompt: "What is the chemical symbol for sodium?",
        points: 1,
        options: [
          { id: randomUUID(), label: "A", content: "S" },
          { id: randomUUID(), label: "B", content: "Na" },
          { id: randomUUID(), label: "C", content: "So" },
          { id: randomUUID(), label: "D", content: "Sd" }
        ],
        correctOptionId: ""
      },
      {
        id: randomUUID(),
        type: "multiple-choice",
        prompt: "Which expression represents the quadratic formula discriminant?",
        points: 1,
        options: [
          { id: randomUUID(), label: "A", content: "\\(b^2 - 4ac\\)" },
          { id: randomUUID(), label: "B", content: "\\(a^2 + b^2\\)" },
          { id: randomUUID(), label: "C", content: "\\(2ab + c\\)" },
          { id: randomUUID(), label: "D", content: "\\(4a^2 - c^2\\)" }
        ],
        correctOptionId: ""
      }
    ],
    createdAt: now,
    updatedAt: now
  };
};

const seedState = (): AppStateSnapshot => {
  const seededExam = sampleExam();
  const firstQuestion = seededExam.questions.at(0);
  const secondQuestion = seededExam.questions.at(1);
  const firstQuestionSecondOption = firstQuestion?.options.at(1);
  const secondQuestionFirstOption = secondQuestion?.options.at(0);

  if (firstQuestion && firstQuestionSecondOption) {
    firstQuestion.correctOptionId = firstQuestionSecondOption.id;
  }

  if (secondQuestion && secondQuestionFirstOption) {
    secondQuestion.correctOptionId = secondQuestionFirstOption.id;
  }

  const hostedExam: Exam = {
    id: randomUUID(),
    mode: "link",
    title: "History LMS Assessment",
    subject: "History",
    className: "Year 11",
    form: "B",
    instructions: "The linked LMS opens inside the secure session shell. Keep your candidate details visible.",
    durationMinutes: 60,
    branding: {
      schoolName: "Northfield Academy",
      accentColor: "#1d4ed8"
    },
    appearance: {
      theme: "light",
      headerLayout: "centered",
      fontScale: 1,
      density: "comfortable"
    },
    questions: [],
    linkConfig: {
      url: "https://docs.google.com/forms/",
      allowedDomains: ["docs.google.com"]
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const exams = [seededExam, hostedExam];

  return {
    exams,
    configPackages: exams.map((exam) => createConfigPackageFromExam(exam)),
    submissions: [],
    studentExamStates: [],
    resultDestinations: [],
    lmsConnections: [],
    settings: defaultSettings,
    securityProfile: defaultSecurityProfile,
    securityLogs: [
      logEntry("package", "info", "Seeded default exam configuration packages."),
      logEntry("kiosk", "info", "Windows kiosk posture starts as not configured until an administrator verifies deployment.")
    ]
  };
};

const reconcilePackages = (snapshot: AppStateSnapshot): AppStateSnapshot => {
  const nextPackages = [...snapshot.configPackages];

  for (const exam of snapshot.exams) {
    const existing = nextPackages.find((candidate) => candidate.examId === exam.id && candidate.status !== "archived");
    if (!existing) {
      nextPackages.push(createConfigPackageFromExam(exam));
      continue;
    }

    const needsRefresh =
      existing.sourceMode !== exam.mode ||
      existing.branding.schoolName !== exam.branding.schoolName ||
      existing.branding.accentColor !== exam.branding.accentColor;

    if (!needsRefresh) {
      continue;
    }

    const updated = withStampedIntegrity({
      ...existing,
      sourceMode: exam.mode,
      browserPolicy: {
        ...existing.browserPolicy,
        startUrl: exam.mode === "link" ? exam.linkConfig?.url : undefined,
        allowedDomains: exam.mode === "link" ? exam.linkConfig?.allowedDomains ?? [] : []
      },
      branding: defaultBranding(exam),
      updatedAt: new Date().toISOString()
    });

    const index = nextPackages.findIndex((candidate) => candidate.id === existing.id);
    nextPackages[index] = updated;
  }

  return {
    ...snapshot,
    configPackages: nextPackages.filter((candidate) => snapshot.exams.some((exam) => exam.id === candidate.examId))
  };
};

const hydrateSnapshot = (raw: Partial<AppStateSnapshot> | null | undefined): AppStateSnapshot => {
  const seeded = seedState();
  const resultDestinations = (raw?.resultDestinations ?? seeded.resultDestinations).map(normalizeResultDestination);
  const lmsConnections = (raw?.lmsConnections ?? seeded.lmsConnections).map(normalizeLmsConnection);
  const snapshot: AppStateSnapshot = {
    exams: (raw?.exams ?? seeded.exams).map(normalizeExam),
    configPackages: (raw?.configPackages ?? []).map(normalizeConfigPackage),
    submissions: (raw?.submissions ?? []).map((submission) => normalizeSubmission(submission, resultDestinations)),
    studentExamStates: (raw?.studentExamStates ?? []).filter(
      (entry): entry is StudentExamState =>
        typeof entry?.examId === "string" && typeof entry?.candidateId === "string" && typeof entry?.hiddenAt === "string"
    ),
    resultDestinations,
    lmsConnections,
    settings: {
      ...defaultSettings,
      ...(raw?.settings ?? {}),
      adminUnlockPin: raw?.settings?.adminUnlockPin ?? raw?.settings?.invigilatorUnlockPin ?? defaultSettings.adminUnlockPin,
      defaultGoogleSheetsSyncEndpoint: raw?.settings?.defaultGoogleSheetsSyncEndpoint?.trim() ?? "",
      googleIntegration: normalizeGoogleIntegration(raw?.settings?.googleIntegration)
    },
    securityProfile: {
      ...defaultSecurityProfile,
      ...(raw?.securityProfile ?? {})
    },
    securityLogs: raw?.securityLogs ?? seeded.securityLogs
  };

  return reconcilePackages(snapshot);
};

const extractFirstJsonDocument = (content: string): string | null => {
  let depth = 0;
  let inString = false;
  let escaping = false;
  let started = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (!char) {
      continue;
    }

    if (!started) {
      if (/\s/.test(char)) {
        continue;
      }

      if (char !== "{") {
        return null;
      }

      started = true;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(0, index + 1);
      }
    }
  }

  return null;
};

const parseSnapshotContent = (content: string): Partial<AppStateSnapshot> =>
  JSON.parse(content.replace(/^\uFEFF/, "")) as Partial<AppStateSnapshot>;

const fileOperationRetryDelays = [40, 120, 240];

const isFileSystemError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const isTransientFileSystemError = (error: unknown): boolean =>
  isFileSystemError(error) &&
  ["EACCES", "EBUSY", "EEXIST", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].includes(error.code ?? "");

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const withFileOperationRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= fileOperationRetryDelays.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryDelay = fileOperationRetryDelays[attempt];
      if (!isTransientFileSystemError(error) || retryDelay === undefined) {
        throw error;
      }
      await delay(retryDelay);
    }
  }

  throw lastError;
};

export interface StorageService {
  getSnapshot(): Promise<AppStateSnapshot>;
  saveExam(exam: Exam): Promise<AppStateSnapshot>;
  deleteExam(examId: string): Promise<AppStateSnapshot>;
  hideExamForStudent(examId: string, candidateId: string): Promise<AppStateSnapshot>;
  saveSettings(settings: AppSettings): Promise<AppStateSnapshot>;
  saveSecurityProfile(profile: SecurityProfile): Promise<AppStateSnapshot>;
  saveConfigPackage(configPackage: ExamConfigPackage): Promise<AppStateSnapshot>;
  saveResultDestination(destination: ResultDestination): Promise<AppStateSnapshot>;
  saveLmsConnection(connection: LmsConnection): Promise<AppStateSnapshot>;
  deleteLmsConnection(connectionId: string): Promise<AppStateSnapshot>;
  deleteResultDestination(destinationId: string): Promise<AppStateSnapshot>;
  updateSubmissionSyncState(submissionId: string, syncState: SubmissionSyncState): Promise<AppStateSnapshot>;
  updateSubmissionStudentLmsTurnIn(submissionId: string, state: StudentLmsTurnInState): Promise<AppStateSnapshot>;
  importExamBundle(exam: Exam, configPackage: ExamConfigPackage): Promise<AppStateSnapshot>;
  deleteConfigPackage(packageId: string): Promise<AppStateSnapshot>;
  duplicateConfigPackage(packageId: string): Promise<AppStateSnapshot>;
  appendSecurityLog(entry: Omit<SecurityLogEntry, "id" | "timestamp">): Promise<AppStateSnapshot>;
  recordSubmission(
    exam: Exam,
    session: ExamSession,
    options?: { externalDeliveryMode?: ExternalDeliveryMode; packageId?: string; resultDestinations?: ResultDestination[] }
  ): Promise<SubmissionResult>;
  exportCsv(examId?: string): Promise<string>;
}

class JsonStorageService implements StorageService {
  private readonly backupPath: string;
  private readonly corruptPath: string;

  constructor(private readonly filePath: string) {
    this.backupPath = `${filePath}.backup.json`;
    this.corruptPath = `${filePath}.corrupt.json`;
  }

  private parse(content: string, allowTrailingContent = false): AppStateSnapshot | null {
    try {
      return hydrateSnapshot(parseSnapshotContent(content));
    } catch {
      if (!allowTrailingContent) {
        return null;
      }

      const recovered = extractFirstJsonDocument(content.replace(/^\uFEFF/, ""));
      if (!recovered) {
        return null;
      }

      try {
        return hydrateSnapshot(parseSnapshotContent(recovered));
      } catch {
        return null;
      }
    }
  }

  private async readFileWithRetry(filePath: string): Promise<string> {
    return withFileOperationRetry(() => readFile(filePath, "utf-8"));
  }

  private async replaceFile(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      await withFileOperationRetry(() => rename(sourcePath, destinationPath));
    } catch (error) {
      if (!isTransientFileSystemError(error)) {
        throw error;
      }

      await withFileOperationRetry(() => rm(destinationPath, { force: true }));
      await withFileOperationRetry(() => rename(sourcePath, destinationPath));
    }
  }

  private async preserveCorruptContent(content: string): Promise<void> {
    if (!content) {
      return;
    }

    try {
      await writeFile(this.corruptPath, content, { encoding: "utf-8", flush: true });
    } catch {
      // Recovery must continue even when the diagnostic copy cannot be written.
    }
  }

  private async ensureStore(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      await this.readFileWithRetry(this.filePath);
      return;
    } catch (error) {
      if (!isFileSystemError(error) || error.code !== "ENOENT") {
        return;
      }
    }

    try {
      const backupContent = await this.readFileWithRetry(this.backupPath);
      const backupSnapshot = this.parse(backupContent, true);
      if (backupSnapshot) {
        await this.write(backupSnapshot, false);
        return;
      }
    } catch (error) {
      if (!isFileSystemError(error) || error.code !== "ENOENT") {
        // A missing or temporarily inaccessible backup must not block first launch.
      }
    }

    await this.write(seedState(), false);
  }

  private async read(): Promise<AppStateSnapshot> {
    await this.ensureStore();
    let content = "";

    try {
      content = await this.readFileWithRetry(this.filePath);
      const parsed = this.parse(content);
      if (parsed) {
        return parsed;
      }
    } catch {
      // The backup below remains readable when security software temporarily locks the live file.
    }

    const recoveredPrimary = this.parse(content, true);
    if (recoveredPrimary) {
      await this.preserveCorruptContent(content);
      recoveredPrimary.securityLogs.unshift(
        logEntry("application", "warning", "Recovered application data after an interrupted local storage write.")
      );
      return this.write(recoveredPrimary, false).catch(() => recoveredPrimary);
    }

    await this.preserveCorruptContent(content);

    try {
      const backupContent = await this.readFileWithRetry(this.backupPath);
      const backupSnapshot = this.parse(backupContent, true);
      if (backupSnapshot) {
        backupSnapshot.securityLogs.unshift(
          logEntry("application", "warning", "Restored application data from the automatic local backup.")
        );
        return this.write(backupSnapshot, false).catch(() => backupSnapshot);
      }
    } catch {
      // The final seeded state below keeps startup usable even when no backup survives.
    }

    const resetSnapshot = seedState();
    resetSnapshot.securityLogs.unshift(
      logEntry("application", "error", "Local application data was unreadable and was reset; a diagnostic copy was preserved.")
    );
    return this.write(resetSnapshot, false).catch(() => resetSnapshot);
  }

  private async write(snapshot: AppStateSnapshot, createBackup = true): Promise<AppStateSnapshot> {
    const hydrated = reconcilePackages(snapshot);
    const serialized = JSON.stringify(hydrated, null, 2);
    const tempPath = `${this.filePath}.${process.pid}-${randomUUID()}.tmp`;

    await writeFile(tempPath, serialized, { encoding: "utf-8", flush: true });

    try {
      if (!this.parse(await this.readFileWithRetry(tempPath))) {
        throw new Error("Refusing to replace application storage with invalid data.");
      }

      if (createBackup) {
        try {
          const currentContent = await this.readFileWithRetry(this.filePath);
          if (this.parse(currentContent)) {
            const backupTempPath = `${this.backupPath}.${process.pid}-${randomUUID()}.tmp`;
            try {
              await writeFile(backupTempPath, currentContent, { encoding: "utf-8", flush: true });
              await this.replaceFile(backupTempPath, this.backupPath);
            } finally {
              await rm(backupTempPath, { force: true }).catch(() => undefined);
            }
          }
        } catch {
          // A backup rotation failure must not prevent a validated state update.
        }
      }

      await this.replaceFile(tempPath, this.filePath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }

    return hydrated;
  }

  async getSnapshot(): Promise<AppStateSnapshot> {
    return this.read();
  }

  async saveExam(exam: Exam): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    const existing = snapshot.exams.findIndex((candidate) => candidate.id === exam.id);
    const nextExam = {
      ...normalizeExam(exam),
      updatedAt: new Date().toISOString()
    };

    if (existing >= 0) {
      snapshot.exams[existing] = nextExam;
    } else {
      snapshot.exams.unshift(nextExam);
    }

    snapshot.securityLogs.unshift(
      logEntry("package", "info", `Saved exam "${nextExam.title || nextExam.id}" and reconciled configuration packages.`)
    );
    return this.write(snapshot);
  }

  async deleteExam(examId: string): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.exams = snapshot.exams.filter((exam) => exam.id !== examId);
    snapshot.configPackages = snapshot.configPackages.filter((configPackage) => configPackage.examId !== examId);
    snapshot.submissions = snapshot.submissions.filter((submission) => submission.examId !== examId);
    snapshot.studentExamStates = snapshot.studentExamStates.filter((entry) => entry.examId !== examId);
    snapshot.securityLogs.unshift(logEntry("package", "warning", `Deleted exam ${examId} and its associated packages.`));
    return this.write(snapshot);
  }

  async hideExamForStudent(examId: string, candidateId: string): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    const existingIndex = snapshot.studentExamStates.findIndex(
      (entry) => entry.examId === examId && entry.candidateId === candidateId
    );
    const nextState: StudentExamState = {
      examId,
      candidateId,
      hiddenAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      snapshot.studentExamStates[existingIndex] = nextState;
    } else {
      snapshot.studentExamStates.unshift(nextState);
    }

    snapshot.securityLogs.unshift(
      logEntry("session", "info", `Student hid completed exam ${examId} from their portal view.`, candidateId)
    );
    return this.write(snapshot);
  }

  async saveSettings(settings: AppSettings): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.settings = settings;
    return this.write(snapshot);
  }

  async saveSecurityProfile(profile: SecurityProfile): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.securityProfile = profile;
    snapshot.securityLogs.unshift(logEntry("kiosk", "info", "Updated Windows kiosk deployment record."));
    return this.write(snapshot);
  }

  async saveConfigPackage(configPackage: ExamConfigPackage): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    const stamped = withStampedIntegrity({
      ...normalizeConfigPackage(configPackage),
      updatedAt: new Date().toISOString()
    });
    const existing = snapshot.configPackages.findIndex((candidate) => candidate.id === configPackage.id);

    if (existing >= 0) {
      snapshot.configPackages[existing] = stamped;
    } else {
      snapshot.configPackages.unshift(stamped);
    }

    snapshot.securityLogs.unshift(
      logEntry("package", "info", `Saved configuration package "${stamped.label}".`, `Checksum ${stamped.integrity.checksum}`)
    );
    return this.write(snapshot);
  }

  async saveResultDestination(destination: ResultDestination): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    const nextDestination = normalizeResultDestination({
      ...destination,
      updatedAt: new Date().toISOString()
    });
    const existing = snapshot.resultDestinations.findIndex((candidate) => candidate.id === destination.id);

    if (existing >= 0) {
      snapshot.resultDestinations[existing] = nextDestination;
    } else {
      snapshot.resultDestinations.unshift(nextDestination);
    }

    snapshot.submissions = snapshot.submissions.map((submission) => normalizeSubmission(submission, snapshot.resultDestinations));
    snapshot.securityLogs.unshift(
      logEntry("results", "info", `Saved result destination "${nextDestination.label}".`, nextDestination.type)
    );
    return this.write(snapshot);
  }

  async saveLmsConnection(connection: LmsConnection): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    const nextConnection = normalizeLmsConnection({
      ...connection,
      updatedAt: new Date().toISOString()
    });
    const existing = snapshot.lmsConnections.findIndex((candidate) => candidate.id === connection.id);

    if (existing >= 0) {
      snapshot.lmsConnections[existing] = nextConnection;
    } else {
      snapshot.lmsConnections.unshift(nextConnection);
    }

    snapshot.securityLogs.unshift(
      logEntry("results", "info", `Saved LMS connection "${nextConnection.label}".`, nextConnection.provider)
    );
    return this.write(snapshot);
  }

  async deleteLmsConnection(connectionId: string): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.lmsConnections = snapshot.lmsConnections.filter((candidate) => candidate.id !== connectionId);
    snapshot.securityLogs.unshift(logEntry("results", "warning", `Deleted LMS connection ${connectionId}.`));
    return this.write(snapshot);
  }

  async deleteResultDestination(destinationId: string): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.resultDestinations = snapshot.resultDestinations.filter((candidate) => candidate.id !== destinationId);
    snapshot.submissions = snapshot.submissions.map((submission) => ({
      ...submission,
      syncStates: submission.syncStates.filter((state) => state.destinationId !== destinationId)
    }));
    snapshot.securityLogs.unshift(logEntry("results", "warning", `Deleted result destination ${destinationId}.`));
    return this.write(snapshot);
  }

  async updateSubmissionSyncState(submissionId: string, syncState: SubmissionSyncState): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.submissions = snapshot.submissions.map((submission) => {
      if (submission.id !== submissionId) {
        return submission;
      }

      const existingIndex = submission.syncStates.findIndex((state) => state.destinationId === syncState.destinationId);
      if (existingIndex < 0) {
        return {
          ...submission,
          syncStates: [...submission.syncStates, syncState]
        };
      }

      return {
        ...submission,
        syncStates: submission.syncStates.map((state, index) => (index === existingIndex ? syncState : state))
      };
    });

    return this.write(snapshot);
  }

  async updateSubmissionStudentLmsTurnIn(submissionId: string, state: StudentLmsTurnInState): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.submissions = snapshot.submissions.map((submission) =>
      submission.id === submissionId
        ? {
            ...submission,
            studentLmsTurnIn: state
          }
        : submission
    );

    return this.write(snapshot);
  }

  async importExamBundle(exam: Exam, configPackage: ExamConfigPackage): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    const nextExam = {
      ...normalizeExam(exam),
      updatedAt: new Date().toISOString()
    };
    const examExisting = snapshot.exams.findIndex((candidate) => candidate.id === nextExam.id);

    if (examExisting >= 0) {
      snapshot.exams[examExisting] = nextExam;
    } else {
      snapshot.exams.unshift(nextExam);
    }

    const stamped = withStampedIntegrity({
      ...normalizeConfigPackage(configPackage),
      examId: nextExam.id,
      updatedAt: new Date().toISOString()
    });
    const packageExisting = snapshot.configPackages.findIndex((candidate) => candidate.id === stamped.id);

    if (packageExisting >= 0) {
      snapshot.configPackages[packageExisting] = stamped;
    } else {
      snapshot.configPackages.unshift(stamped);
    }

    snapshot.securityLogs.unshift(
      logEntry(
        "package",
        "info",
        `Imported exam bundle "${nextExam.title || nextExam.id}".`,
        `Package ${stamped.label}`
      )
    );
    return this.write(snapshot);
  }

  async deleteConfigPackage(packageId: string): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.configPackages = snapshot.configPackages.filter((candidate) => candidate.id !== packageId);
    snapshot.securityLogs.unshift(logEntry("package", "warning", `Deleted configuration package ${packageId}.`));
    return this.write(snapshot);
  }

  async duplicateConfigPackage(packageId: string): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    const existing = snapshot.configPackages.find((candidate) => candidate.id === packageId);
    if (!existing) {
      throw new Error("Configuration package not found.");
    }

    const duplicate = withStampedIntegrity({
      ...existing,
      id: randomUUID(),
      label: `${existing.label} copy`,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      integrity: {
        ...existing.integrity,
        checksum: ""
      }
    });

    snapshot.configPackages.unshift(duplicate);
    snapshot.securityLogs.unshift(logEntry("package", "info", `Duplicated configuration package "${existing.label}".`));
    return this.write(snapshot);
  }

  async appendSecurityLog(entry: Omit<SecurityLogEntry, "id" | "timestamp">): Promise<AppStateSnapshot> {
    const snapshot = await this.read();
    snapshot.securityLogs.unshift({
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString()
    });
    snapshot.securityLogs = snapshot.securityLogs.slice(0, 300);
    return this.write(snapshot);
  }

  async recordSubmission(
    exam: Exam,
    session: ExamSession,
    options?: { externalDeliveryMode?: ExternalDeliveryMode; packageId?: string; resultDestinations?: ResultDestination[] }
  ): Promise<SubmissionResult> {
    const snapshot = await this.read();
    const resultDestinations = options?.resultDestinations ?? snapshot.resultDestinations;
    const result = {
      ...scoreSubmission(exam, session),
      packageId: options?.packageId,
      externalDeliveryMode: options?.externalDeliveryMode,
      candidateClassName: session.candidate.className?.trim() || undefined,
      syncStates: buildSubmissionSyncStates(resultDestinations)
    };
    snapshot.submissions.unshift(result);
    snapshot.securityLogs.unshift(
      logEntry("session", "info", `Recorded submission for "${exam.title}" by ${session.candidate.name}.`)
    );
    await this.write(snapshot);
    return result;
  }

  async exportCsv(examId?: string): Promise<string> {
    const snapshot = await this.read();
    const rows = snapshot.submissions.filter((submission) => (examId ? submission.examId === examId : true));
    const header = ["Candidate Name", "Candidate ID", "Exam", "Score", "Total", "Percentage", "Submitted At"];
    const content = rows
      .map((row) =>
        [
          row.candidateName,
          row.candidateId,
          row.examTitle,
          row.score,
          row.totalPoints,
          row.percentage,
          row.submittedAt
        ]
          .map((field) => `"${String(field).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    return `${header.join(",")}\n${content}`;
  }
}

class SerializedStorageService implements StorageService {
  private operationTail: Promise<void> = Promise.resolve();

  constructor(private readonly storage: StorageService) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  getSnapshot(): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.getSnapshot());
  }

  saveExam(exam: Exam): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.saveExam(exam));
  }

  deleteExam(examId: string): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.deleteExam(examId));
  }

  hideExamForStudent(examId: string, candidateId: string): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.hideExamForStudent(examId, candidateId));
  }

  saveSettings(settings: AppSettings): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.saveSettings(settings));
  }

  saveSecurityProfile(profile: SecurityProfile): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.saveSecurityProfile(profile));
  }

  saveConfigPackage(configPackage: ExamConfigPackage): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.saveConfigPackage(configPackage));
  }

  saveResultDestination(destination: ResultDestination): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.saveResultDestination(destination));
  }

  saveLmsConnection(connection: LmsConnection): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.saveLmsConnection(connection));
  }

  deleteLmsConnection(connectionId: string): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.deleteLmsConnection(connectionId));
  }

  deleteResultDestination(destinationId: string): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.deleteResultDestination(destinationId));
  }

  updateSubmissionSyncState(submissionId: string, syncState: SubmissionSyncState): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.updateSubmissionSyncState(submissionId, syncState));
  }

  updateSubmissionStudentLmsTurnIn(submissionId: string, state: StudentLmsTurnInState): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.updateSubmissionStudentLmsTurnIn(submissionId, state));
  }

  importExamBundle(exam: Exam, configPackage: ExamConfigPackage): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.importExamBundle(exam, configPackage));
  }

  deleteConfigPackage(packageId: string): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.deleteConfigPackage(packageId));
  }

  duplicateConfigPackage(packageId: string): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.duplicateConfigPackage(packageId));
  }

  appendSecurityLog(entry: Omit<SecurityLogEntry, "id" | "timestamp">): Promise<AppStateSnapshot> {
    return this.enqueue(() => this.storage.appendSecurityLog(entry));
  }

  recordSubmission(
    exam: Exam,
    session: ExamSession,
    options?: { externalDeliveryMode?: ExternalDeliveryMode; packageId?: string; resultDestinations?: ResultDestination[] }
  ): Promise<SubmissionResult> {
    return this.enqueue(() => this.storage.recordSubmission(exam, session, options));
  }

  exportCsv(examId?: string): Promise<string> {
    return this.enqueue(() => this.storage.exportCsv(examId));
  }
}

export const createStorageService = (dataDir: string): StorageService =>
  new SerializedStorageService(new JsonStorageService(join(dataDir, "lockedscreen-state.json")));
