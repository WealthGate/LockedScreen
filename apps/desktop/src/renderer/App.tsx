import { useCallback, useEffect, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock3,
  Download,
  FileInput,
  Flag,
  LayoutDashboard,
  Loader2,
  Lock,
  Moon,
  Plus,
  Save,
  Settings,
  ShieldCheck,
  Sun,
  Trash2
} from "lucide-react";
import { MemoryRouter, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

import { calculateCompletion, createSession, getRemainingSeconds, updateResponse } from "@lockedscreen/exam-engine";
import type {
  Candidate,
  AppSettings,
  AppStateSnapshot,
  AppUpdateState,
  BrowserDisplayMode,
  ExamConfigPackage,
  Exam,
  ExamAppearance,
  ExamSession,
  ImportPreview,
  ImportedExamMetadata,
  ImportedQuestionDraft,
  LaunchContext,
  InstalledAppRole,
  LmsConnection,
  LmsCourse,
  LmsCourseWork,
  LmsStudent,
  LmsProviderType,
  PackageUrlRule,
  Question,
  ResultDestination,
  ResultDestinationType,
  ResultSyncAuthMode,
  ResultSyncStatus,
  SecurityOverview,
  SecurityProfile,
  StudentAccessPolicy,
  StudentLmsBinding,
  StudentLmsProviderType,
  ThemePreference,
  SubmissionResult,
  ValidationItem,
  VerificationStatus
} from "@lockedscreen/shared-types";
import { Badge, Button, Card, CardDescription, CardTitle, Input, Textarea } from "@lockedscreen/ui";

import desktopPackage from "../../package.json";
import { RichContent } from "./components/rich-content";
import { RichContentEditor } from "./components/rich-content-editor";
import { useLockedscreenStore } from "./lib/store";

const teacherNavItems = [
  { to: "/teacher", label: "Dashboard", icon: LayoutDashboard },
  { to: "/teacher/builder/new", label: "Create Exam", icon: Plus },
  { to: "/teacher/import", label: "Import", icon: FileInput },
  { to: "/teacher/results", label: "Results", icon: Download },
  { to: "/teacher/settings", label: "Admin Console", icon: Settings }
];

const animation = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.16 }
};

const hostedExamUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const minExamZoom = 0.75;
const maxExamZoom = 1.75;
const examZoomStep = 0.1;
const sessionReleaseTimeoutMs = 5000;
const initialUpdateState: AppUpdateState = {
  status: "idle",
  currentVersion: desktopPackage.version
};

const clampExamZoom = (value: number) =>
  Math.min(maxExamZoom, Math.max(minExamZoom, Math.round(value * 100) / 100));

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitForSessionRelease = async (operation: Promise<unknown>): Promise<boolean> => {
  let finished = false;
  let failure: unknown;

  const guardedOperation = operation
    .then(() => {
      finished = true;
    })
    .catch((error) => {
      finished = true;
      failure = error;
    });

  await Promise.race([guardedOperation, wait(sessionReleaseTimeoutMs)]);

  if (failure) {
    throw failure;
  }

  return finished;
};

const isHostedFormCompletionUrl = (candidateUrl: string) => {
  try {
    const parsed = new URL(candidateUrl);
    return (
      parsed.hostname === "docs.google.com" &&
      parsed.pathname.includes("/forms/") &&
      (parsed.pathname.includes("/formResponse") || parsed.searchParams.has("submit") || parsed.search.includes("form_confirm"))
    );
  } catch {
    return false;
  }
};

const blankAppearance = (): ExamAppearance => ({
  theme: "system",
  headerLayout: "split",
  fontScale: 1,
  density: "comfortable"
});

const blankExam = (mode: Exam["mode"] = "app"): Exam => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    mode,
    title: "",
    subject: "",
    className: "",
    form: "",
    instructions: "Read each question carefully. Stay inside the secure environment until the invigilator ends the session.",
    durationMinutes: 45,
    branding: {
      schoolName: "",
      accentColor: "#0f766e"
    },
    appearance: blankAppearance(),
    questions: [],
    linkConfig: mode === "link" ? { url: "", allowedDomains: [] } : undefined,
    createdAt: now,
    updatedAt: now
  };
};

const blankQuestion = (): Question => {
  const options = [
    { id: crypto.randomUUID(), label: "A", content: "" },
    { id: crypto.randomUUID(), label: "B", content: "" },
    { id: crypto.randomUUID(), label: "C", content: "" },
    { id: crypto.randomUUID(), label: "D", content: "" }
  ];
  const firstOption = options.at(0);

  return {
    id: crypto.randomUUID(),
    type: "multiple-choice",
    prompt: "",
    points: 1,
    options,
    correctOptionId: firstOption ? firstOption.id : ""
  };
};

const blankResultDestination = (): ResultDestination => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    label: "New destination",
    type: "google-sheets",
    enabled: true,
    trigger: "manual",
    endpointUrl: "",
    authMode: "none",
    authToken: "",
    apiKeyHeader: "x-api-key",
    className: "",
    courseId: "",
    assignmentId: "",
    assignmentLabel: "",
    connectionId: "",
    bridgeEndpointUrl: "",
    sortByLastName: true,
    sheetName: "",
    examIds: [],
    includeResponses: true,
    notes: "",
    createdAt: now,
    updatedAt: now
  };
};

const defaultLmsScope = (provider: LmsProviderType): string =>
  provider === "google-classroom"
    ? [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.students",
        "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
        "https://www.googleapis.com/auth/classroom.rosters.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets"
      ].join(" ")
    : provider === "microsoft-365"
      ? [
          "offline_access",
          "openid",
          "profile",
          "User.Read",
          "EduRoster.ReadBasic",
          "EduAssignments.ReadWriteBasic",
          "Files.ReadWrite"
        ].join(" ")
      : "openid profile email";

const blankLmsConnection = (provider: LmsProviderType = "google-classroom"): LmsConnection => {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    label: providerLabel(provider),
    provider,
    status: "disconnected",
    clientId: "",
    clientSecret: "",
    tenantId: provider === "microsoft-365" ? "common" : "",
    authorizeUrl: "",
    tokenUrl: "",
    scope: defaultLmsScope(provider),
    accountEmail: "",
    accountName: "",
    lastConnectedAt: undefined,
    lastError: undefined,
    createdAt: now,
    updatedAt: now
  };
};

const defaultStudentLmsScope = (provider: StudentLmsProviderType): string =>
  provider === "google-classroom"
    ? [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/classroom.coursework.me",
        "https://www.googleapis.com/auth/drive.file"
      ].join(" ")
    : ["offline_access", "openid", "profile", "User.Read", "EduAssignments.ReadWrite", "Files.ReadWrite"].join(" ");

const blankStudentLmsBinding = (provider: StudentLmsProviderType = "google-classroom"): StudentLmsBinding => ({
  enabled: false,
  provider,
  connectionId: "",
  clientId: "",
  clientSecret: undefined,
  tenantId: provider === "microsoft-365" ? "common" : "",
  scope: defaultStudentLmsScope(provider),
  courseId: "",
  courseLabel: "",
  assignmentId: "",
  assignmentLabel: ""
});

const lockdownOnlyStudentLmsBinding = (provider: StudentLmsProviderType = "google-classroom"): StudentLmsBinding => ({
  ...blankStudentLmsBinding(provider),
  scope: ""
});

const formatTime = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
};

const themeClass = (theme: ThemePreference): string => {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "";
  }

  return theme === "dark" ? "dark" : "";
};

const usesOfficialKiosk = (profile: SecurityProfile): boolean =>
  profile.kioskMode === "assigned-access" || profile.kioskMode === "shell-launcher" || profile.kioskMode === "hybrid";

const usesNativeCompanion = (profile: SecurityProfile): boolean =>
  profile.kioskMode === "windows-native-companion" || profile.kioskMode === "hybrid";

const isSecureSessionReady = (snapshot: AppStateSnapshot): boolean => {
  const officialKioskReady =
    snapshot.securityProfile.kioskConfigured &&
    snapshot.securityProfile.dedicatedExamAccount &&
    usesOfficialKiosk(snapshot.securityProfile);
  const nativeReady =
    snapshot.securityProfile.nativeCompanionVerified &&
    usesNativeCompanion(snapshot.securityProfile) &&
    snapshot.runtime?.nativeLockdown.lockdownCapable === true;

  return officialKioskReady || nativeReady;
};

const canUseTestingMode = (snapshot: AppStateSnapshot): boolean =>
  snapshot.settings.allowNonKioskTestingMode || snapshot.runtime?.canOnlyUseTestingMode === true;

const testingModeCopy = (snapshot: AppStateSnapshot): string =>
  snapshot.runtime?.canOnlyUseTestingMode
    ? "will run in Windows Home testing mode because no verified native Windows lockdown companion is active on this device. The app stays full-screen and keeps the exam workflow contained, but the Windows key, task switching, and taskbar surfaces remain under OS control. This is not a secure exam deployment."
    : "can run in testing mode on unmanaged devices, but the strongest lockdown still requires a verified native Windows companion or official Windows kiosk deployment. This is not a secure exam deployment.";

const testingModeLabel = (snapshot: AppStateSnapshot): string =>
  snapshot.runtime?.canOnlyUseTestingMode ? "Windows Home testing mode" : "Testing mode";

const getConfigPackageForExam = (snapshot: AppStateSnapshot | null, examId: string): ExamConfigPackage | null => {
  if (!snapshot) {
    return null;
  }

  return (
    snapshot.configPackages.find((candidate) => candidate.examId === examId && candidate.status !== "archived") ??
    snapshot.configPackages.find((candidate) => candidate.examId === examId) ??
    null
  );
};

const isNativeFullKioskExam = (snapshot: AppStateSnapshot, examId: string): boolean => {
  const configPackage = getConfigPackageForExam(snapshot, examId);
  return (
    configPackage?.securityMode === "full-kiosk" &&
    snapshot.securityProfile.nativeCompanionVerified &&
    usesNativeCompanion(snapshot.securityProfile)
  );
};

const requiresInvigilatorExitAfterSubmit = (configPackage: ExamConfigPackage | null): boolean =>
  Boolean(configPackage?.quitUnlockPolicy.requireInvigilatorPin);

const defaultCandidate = (): Candidate => ({
  id: `candidate-${Date.now()}`,
  name: "Candidate",
  className: ""
});

const createCandidateId = (name: string, candidateId: string): string => {
  const trimmedId = candidateId.trim();
  if (trimmedId.length > 0) {
    return trimmedId;
  }

  const derived = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return derived || `candidate-${Date.now()}`;
};

const normalizeCandidate = (name: string, candidateId: string, className = ""): Candidate => {
  const trimmedName = name.trim();
  return {
    name: trimmedName || "Candidate",
    id: createCandidateId(trimmedName, candidateId),
    className: className.trim()
  };
};

const buildExamRoute = (exam: Exam, candidate: Candidate): string => {
  const path = exam.mode === "link" ? `/link/${exam.id}` : `/session/${exam.id}`;
  const params = new URLSearchParams({
    candidateName: candidate.name,
    candidateId: candidate.id
  });
  if (candidate.className?.trim()) {
    params.set("candidateClassName", candidate.className.trim());
  }
  return `${path}?${params.toString()}`;
};

const parseCandidateFromSearch = (search: string): Candidate | null => {
  const params = new URLSearchParams(search);
  const name = params.get("candidateName")?.trim() ?? "";
  const id = params.get("candidateId")?.trim() ?? "";
  const className = params.get("candidateClassName")?.trim() ?? "";
  if (!name && !id) {
    return null;
  }

  return normalizeCandidate(name, id, className);
};

const splitCommaList = (value: string): string[] =>
  value
    .split(/[,\r\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const serializeCommaList = (values: string[]): string => values.join(", ");

const hasReachedAvailabilityStart = (availableFrom?: string): boolean => {
  const now = Date.now();
  const startsAt = availableFrom ? new Date(availableFrom).getTime() : Number.NaN;

  if (!Number.isNaN(startsAt) && now < startsAt) {
    return false;
  }

  return true;
};

const isPastAvailabilityEnd = (availableUntil?: string): boolean => {
  const now = Date.now();
  const endsAt = availableUntil ? new Date(availableUntil).getTime() : Number.NaN;

  if (!Number.isNaN(endsAt) && now > endsAt) {
    return true;
  }

  return false;
};

const formatDateTime = (value?: string): string | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toLocaleString();
};

const splitLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const splitScopes = (value: string): string[] =>
  value
    .split(/[\s,\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const mergeGoogleDefaultScopes = (scopes: string[]): string[] =>
  Array.from(new Set([...scopes.map((scope) => scope.trim()).filter(Boolean), ...defaultLmsScope("google-classroom").split(/\s+/)]));

const normalizeStartCode = (value: string): string => value.trim();

const hasExamStartCode = (policy?: StudentAccessPolicy | null): boolean =>
  Boolean(policy?.startCodeHash && policy.startCodeSalt);

const createStartCodeSalt = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hashExamStartCode = (code: string, salt: string): Promise<string> =>
  sha256Hex(`${salt}:${normalizeStartCode(code)}`);

const verifyExamStartCode = async (code: string, policy: StudentAccessPolicy): Promise<boolean> => {
  if (!hasExamStartCode(policy) || !policy.startCodeHash || !policy.startCodeSalt) {
    return true;
  }

  if (normalizeStartCode(code).length === 0) {
    return false;
  }

  return (await hashExamStartCode(code, policy.startCodeSalt)) === policy.startCodeHash;
};

const serializeUrlRules = (rules: PackageUrlRule[]): string =>
  rules
    .map((rule) => [rule.label, rule.kind, rule.role, rule.pattern, rule.allowSubdomains ? "subdomains" : "exact"].join("|"))
    .join("\n");

const parseUrlRules = (value: string): PackageUrlRule[] =>
  splitLines(value).map((line) => {
    const [label, kind, role, pattern, mode] = line.split("|").map((entry) => entry.trim());
    return {
      id: crypto.randomUUID(),
      label: label || "Rule",
      kind: kind === "prefix" ? "prefix" : "domain",
      role:
        role === "start" || role === "resource" || role === "help" || role === "exit"
          ? role
          : "exam",
      pattern: pattern || "",
      allowSubdomains: mode === "subdomains"
    };
  });

const serializeAllowedApps = (configPackage: ExamConfigPackage): string =>
  configPackage.allowedApplications
    .map((entry) => [entry.label, entry.executablePath, entry.args.join(" "), entry.supervision, entry.notes ?? ""].join("|"))
    .join("\n");

const parseAllowedApps = (value: string): ExamConfigPackage["allowedApplications"] =>
  splitLines(value).map((line) => {
    const [label, executablePath, argString, supervision, notes] = line.split("|").map((entry) => entry.trim());
    return {
      id: crypto.randomUUID(),
      label: label || "Approved application",
      executablePath: executablePath || "",
      args: argString ? argString.split(/\s+/).filter(Boolean) : [],
      supervision: supervision === "monitor-only" ? "monitor-only" : "launch-and-monitor",
      notes: notes || undefined
    };
  });

const findImportedPackage = (
  previousPackages: Map<string, string>,
  nextPackages: ExamConfigPackage[]
): ExamConfigPackage | null =>
  nextPackages.find((candidate) => previousPackages.get(candidate.id) !== `${candidate.updatedAt}|${candidate.integrity.checksum}`) ??
  nextPackages[0] ??
  null;

const findImportedExam = (previousExams: Map<string, string>, nextExams: Exam[]): Exam | null =>
  nextExams.find((candidate) => previousExams.get(candidate.id) !== candidate.updatedAt) ?? nextExams[0] ?? null;

const buildDashboardLaunchRoute = (examId: string): string => `/student?launchExamId=${encodeURIComponent(examId)}`;

const cloneImportMetadata = (metadata: ImportedExamMetadata): ImportedExamMetadata => ({ ...metadata });

const cloneImportQuestions = (questions: ImportedQuestionDraft[]): ImportedQuestionDraft[] =>
  questions.map((question) => ({
    ...question,
    options: question.options.map((option) => ({ ...option }))
  }));

const hydrateImportReview = (preview: ImportPreview | null): { metadata: ImportedExamMetadata | null; questions: ImportedQuestionDraft[] } => ({
  metadata: preview ? cloneImportMetadata(preview.metadata) : null,
  questions: preview ? cloneImportQuestions(preview.questions) : []
});

const statusTone = (status: VerificationStatus): string =>
  status === "pass"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-100"
    : status === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/60 dark:text-amber-100"
      : status === "fail"
        ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/60 dark:text-rose-100"
        : "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";

const feedbackTone = (tone: "success" | "error" | "info"): string =>
  tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-100"
    : tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/60 dark:text-rose-100"
      : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/70 dark:bg-blue-950/60 dark:text-blue-100";

const selectClassName =
  "h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:ring-offset-2 focus:ring-offset-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-offset-slate-950";

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }

  if (target instanceof HTMLSelectElement) {
    return !target.disabled;
  }

  return target.isContentEditable;
};

type AdminActionState =
  | "refresh-diagnostics"
  | "save-posture"
  | "save-package"
  | "save-settings"
  | "save-destination"
  | "delete-destination"
  | "save-lms-connection"
  | "delete-lms-connection"
  | "connect-lms"
  | "sign-out-lms"
  | "clear-lms-tokens"
  | "load-lms-courses"
  | "load-lms-coursework"
  | "load-lms-students"
  | "duplicate-package"
  | "delete-package"
  | "publish-classroom-package"
  | "export-package"
  | "import-package";

interface ActionFeedback {
  tone: "success" | "error" | "info";
  text: string;
}

type SettingsTab =
  | "overview"
  | "google"
  | "turnin"
  | "results"
  | "package"
  | "student-access"
  | "runtime"
  | "controls"
  | "security";

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "google", label: "Google Classroom" },
  { id: "turnin", label: "Student turn-in" },
  { id: "results", label: "Grade sync" },
  { id: "package", label: "Package basics" },
  { id: "student-access", label: "Student access" },
  { id: "runtime", label: "Runtime" },
  { id: "controls", label: "Controls" },
  { id: "security", label: "Security" }
];

const integrationSettingsTabs = new Set<SettingsTab>(["google", "turnin", "results"]);

const resultSyncTone = (status: ResultSyncStatus): string =>
  status === "success"
    ? "bg-emerald-100 text-emerald-900"
    : status === "failed"
      ? "bg-rose-100 text-rose-900"
      : status === "pending"
        ? "bg-amber-100 text-amber-900"
        : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100";

const studentTurnInTone = (status?: "pending" | "success" | "failed" | "skipped"): string =>
  status === "success"
    ? "bg-emerald-100 text-emerald-900"
    : status === "failed"
      ? "bg-rose-100 text-rose-900"
      : status === "pending"
        ? "bg-amber-100 text-amber-900"
        : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100";

const providerLabel = (type: ResultDestinationType | LmsProviderType): string =>
  type === "google-classroom"
    ? "Google Classroom"
    : type === "google-classroom-grade-sync"
      ? "Google Classroom grade sync"
      : type === "microsoft-teams"
      ? "Microsoft Teams"
      : type === "microsoft-365"
        ? "Microsoft 365"
      : type === "google-sheets"
        ? "Google Sheets"
        : type === "generic-oauth-lms"
          ? "Generic OAuth LMS"
          : "Generic LMS";

const lmsConnectActionLabel = (connection: LmsConnection): string =>
  connection.provider === "google-classroom"
    ? connection.status === "connected"
      ? "Reconnect Google Classroom"
      : "Connect Google Classroom"
    : connection.provider === "microsoft-365"
      ? connection.status === "connected"
        ? "Reconnect Microsoft 365"
        : "Connect Microsoft 365"
      : connection.status === "connected"
        ? "Reconnect LMS"
        : "Connect LMS";

const hasAdminLmsSetup = (connection: LmsConnection): boolean =>
  connection.clientId.trim().length > 0 &&
  (connection.provider !== "generic-oauth-lms" ||
    ((connection.authorizeUrl?.trim().length ?? 0) > 0 && (connection.tokenUrl?.trim().length ?? 0) > 0));

const lmsAccountDisplayName = (connection: LmsConnection): string => {
  const account = connection.accountName?.trim() || connection.accountEmail?.trim();
  if (account) {
    return account;
  }

  return connection.label.trim() || providerLabel(connection.provider);
};

const blankResultDestinationWithDefaults = (settings?: AppSettings | null): ResultDestination => ({
  ...blankResultDestination(),
  bridgeEndpointUrl: settings?.defaultGoogleSheetsSyncEndpoint?.trim() ?? ""
});

const lmsAccountOptionLabel = (connection: LmsConnection): string => {
  const accountName = connection.accountName?.trim();
  const accountEmail = connection.accountEmail?.trim();
  if (accountName && accountEmail && accountName !== accountEmail) {
    return `${accountName} (${accountEmail})`;
  }

  return accountName || accountEmail || connection.label || providerLabel(connection.provider);
};

const AppFrame = () => {
  const location = useLocation();
  const { snapshot, loading, error, load } = useLockedscreenStore();
  const [launchContext, setLaunchContext] = useState<LaunchContext | null>(null);
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(initialUpdateState);
  const installedRole: InstalledAppRole = launchContext?.installedRole ?? "teacher";
  const isStudentRoute =
    installedRole === "student" ||
    location.pathname.startsWith("/student") ||
    location.pathname.startsWith("/session/") ||
    location.pathname.startsWith("/link/") ||
    location.pathname.startsWith("/package-import");
  const canShowUpdates = !location.pathname.startsWith("/session/") && !location.pathname.startsWith("/link/");

  useEffect(() => {
    void load();
    void window.lockedscreenApi.getLaunchContext().then(setLaunchContext);
    const unsubscribe = window.lockedscreenApi.onLaunchContextChanged(setLaunchContext);
    return unsubscribe;
  }, [load]);

  useEffect(() => {
    void window.lockedscreenApi.getUpdateState().then(setUpdateState);
    const unsubscribe = window.lockedscreenApi.onUpdateStateChanged(setUpdateState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.documentElement.className = themeClass(snapshot?.settings.defaultTheme ?? "system");
  }, [snapshot?.settings.defaultTheme]);

  if (loading && !snapshot) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-800 dark:text-slate-100">Loading workspace...</div>;
  }

  if (!snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-rose-600">
        {error ?? "Unable to load application state."}
      </div>
    );
  }

  return (
    <div className={`min-h-screen text-slate-900 dark:text-slate-100 ${isStudentRoute ? "p-2 sm:p-3" : "p-4 sm:p-6"}`}>
      {canShowUpdates && updateState ? <UpdateBanner state={updateState} /> : null}
      {installedRole === "student" ? (
        <Routes>
          <Route path="/" element={<StudentPortalPage />} />
          <Route path="/student" element={<StudentPortalPage />} />
          <Route path="/session/:examId" element={<StudentExamPage />} />
          <Route path="/link/:examId" element={<LinkExamPage />} />
          <Route path="/package-import" element={<PackageImportPage launchContext={launchContext} />} />
          <Route path="*" element={<StudentPortalPage />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<ProfileSelectPage launchContext={launchContext} />} />
          <Route path="/student" element={<StudentPortalPage />} />
          <Route path="/session/:examId" element={<StudentExamPage />} />
          <Route path="/link/:examId" element={<LinkExamPage />} />
          <Route path="/package-import" element={<PackageImportPage launchContext={launchContext} />} />
          <Route path="/teacher/*" element={<TeacherShell launchContext={launchContext} />} />
          <Route path="*" element={<ProfileSelectPage launchContext={launchContext} />} />
        </Routes>
      )}
      {launchContext?.route ? (
        <LaunchContextNavigator
          route={launchContext.route}
          navigationKey={`${launchContext.route}|${launchContext.packageImport?.filePath ?? ""}`}
        />
      ) : null}
      {canShowUpdates ? <AppVersionStatus state={updateState} /> : null}
    </div>
  );
};

const LaunchContextNavigator = ({ route, navigationKey }: { route: string; navigationKey: string }) => {
  const navigate = useNavigate();
  const lastNavigationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastNavigationKeyRef.current === navigationKey) {
      return;
    }

    lastNavigationKeyRef.current = navigationKey;
    navigate(route, { replace: true });
  }, [navigate, navigationKey, route]);

  return null;
};

const TeacherShell = ({ launchContext }: { launchContext: LaunchContext | null }) => {
  const { error } = useLockedscreenStore();
  const navigate = useNavigate();

  return (
    <div className="grid min-h-[calc(100vh-2rem)] gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-[32px] border border-white/60 bg-slate-950/90 p-6 text-white shadow-2xl shadow-slate-900/30">
        <div className="mb-10 flex items-center gap-3">
          <div className="rounded-2xl bg-teal-500/20 p-3 text-teal-200">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <div className="text-sm uppercase tracking-[0.3em] text-slate-400">LOCKEDSCREEN</div>
            <div className="text-xl font-semibold">Exam Control</div>
          </div>
        </div>

        <nav className="space-y-2">
          {teacherNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition ${
                    isActive ? "bg-white text-slate-950 shadow-glow" : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <Card className="mt-10 border-none bg-slate-900 p-5 text-white">
          <CardTitle className="text-white">Deployment note</CardTitle>
          <CardDescription className="mt-2 text-slate-100">
            Real lockdown depends on a verified native Windows lockdown companion or official Windows kiosk deployment. The in-app window assist only reinforces the active exam window.
          </CardDescription>
        </Card>
      </aside>

      <main className="overflow-hidden rounded-[36px] border border-white bg-white p-6 shadow-[0_50px_100px_-48px_rgba(15,23,42,0.45)] dark:border-slate-800 dark:bg-slate-950">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-800 dark:text-slate-100">Teacher / School</div>
            <div className="text-sm text-slate-900 dark:text-slate-100">Use Back, Forward, or Dashboard to move around the admin workspace.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button variant="secondary" onClick={() => navigate(1)}>
              <ArrowRight className="size-4" />
              Forward
            </Button>
            <Button variant="secondary" onClick={() => navigate("/teacher")}>
              <LayoutDashboard className="size-4" />
              Dashboard
            </Button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="builder/:examId" element={<BuilderPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="package-import" element={<PackageImportPage launchContext={launchContext} />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  );
};

const ProfileSelectPage = ({ launchContext }: { launchContext: LaunchContext | null }) => {
  const navigate = useNavigate();
  const { snapshot } = useLockedscreenStore();
  const readyExams = snapshot?.exams ?? [];

  return (
    <motion.div key="profile-select" {...animation} className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center">
      <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="relative overflow-hidden bg-slate-950 p-8 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.35),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.25),transparent_30%)]" />
          <div className="relative space-y-6">
            <Badge className="bg-white/10 text-white">LOCKEDSCREEN</Badge>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight">Choose how you are using the exam app.</h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-300">
                Students only see exam information, sign in with their details, and start the exam. Teachers and schools get the full setup and administration workspace.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button className="bg-white text-slate-950 hover:bg-slate-100" onClick={() => navigate("/student")}>
                <Lock className="size-4" />
                Student
              </Button>
              <Button variant="secondary" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => navigate("/teacher")}>
                <Settings className="size-4" />
                Teacher / School
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Available exams" value={String(readyExams.length)} />
              <StatCard label="Submissions" value={String(snapshot?.submissions.length ?? 0)} />
              <StatCard label="Launch mode" value={launchContext?.nativeHosted ? "Native host" : "Desktop app"} />
            </div>
          </div>
        </Card>

        <Card className="space-y-4 bg-gradient-to-b from-white to-slate-50 text-slate-950 dark:text-slate-950">
          <CardTitle className="text-slate-950 dark:text-slate-950">Quick start</CardTitle>
          <div className="space-y-3 text-sm text-slate-950">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950">
              Students: open <span className="font-semibold">Student</span>, enter your name, candidate ID, and class, then start your assigned exam.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950">
              Teachers: open <span className="font-semibold">Teacher / School</span> to create exams, import papers, configure packages, and review results.
            </div>
            {launchContext?.packageImport ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                An exam package is waiting to be opened. Use the Teacher / School profile to unlock and import it.
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </motion.div>
  );
};

const StudentPortalPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { snapshot, launchAlternateDesktopSession, hideExamForStudent } = useLockedscreenStore();
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [candidateClassName, setCandidateClassName] = useState("");
  const [examStartCodeAttempt, setExamStartCodeAttempt] = useState("");
  const [examStartCodeError, setExamStartCodeError] = useState<string | null>(null);
  const [launchFeedback, setLaunchFeedback] = useState<ActionFeedback | null>(null);
  const identifiedCandidate =
    candidateName.trim().length > 0 ? normalizeCandidate(candidateName, candidateId, candidateClassName) : null;
  const normalizedCandidateId = identifiedCandidate?.id ?? createCandidateId(candidateName, candidateId);
  const normalizedCandidateClass = candidateClassName.trim().toLowerCase();

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const examId = new URLSearchParams(location.search).get("launchExamId");
    if (!examId) {
      return;
    }

    const exam = snapshot.exams.find((candidate) => candidate.id === examId) ?? null;
    setSelectedExam(exam);
    setLaunchFeedback(null);
    navigate("/student", { replace: true });
  }, [location.search, navigate, snapshot]);

  if (!snapshot) {
    return null;
  }

  const launchExam = async (exam: Exam, candidate: Candidate): Promise<boolean> => {
    setLaunchFeedback(null);
    setExamStartCodeError(null);

    const configPackage = getConfigPackageForExam(snapshot, exam.id);
    if (configPackage?.studentAccessPolicy && hasExamStartCode(configPackage.studentAccessPolicy)) {
      const startCodeValid = await verifyExamStartCode(examStartCodeAttempt, configPackage.studentAccessPolicy);
      if (!startCodeValid) {
        setExamStartCodeError("Enter the exam start code provided by your teacher or invigilator.");
        return false;
      }
    }

    if (!isSecureSessionReady(snapshot) && !canUseTestingMode(snapshot)) {
      setLaunchFeedback({
        tone: "error",
        text: "This device is not ready for the exam yet. Ask the teacher or invigilator to prepare the exam workstation before starting."
      });
      return false;
    }

    if (isNativeFullKioskExam(snapshot, exam.id)) {
      try {
        const handedOff = await launchAlternateDesktopSession({ examId: exam.id, candidate });
        if (handedOff) {
          return true;
        }
      } catch (error) {
        setLaunchFeedback({
          tone: "error",
          text:
            error instanceof Error
              ? `${error.message} This full-kiosk exam cannot start until native Windows lockdown is active.`
              : "Native lockdown launch failed. This full-kiosk exam cannot start until the Windows lockdown companion is active."
        });
        return false;
      }
    }

    navigate(buildExamRoute(exam, candidate));
    return true;
  };

  const assignedExamCards = !snapshot || !identifiedCandidate
    ? []
    : snapshot.exams
        .map((exam) => {
          const configPackage = getConfigPackageForExam(snapshot, exam.id);
          if (!configPackage || configPackage.status === "archived") {
            return null;
          }

          const policy = configPackage.studentAccessPolicy;
          const assignedClasses = policy.assignedClassNames.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
          const assignedCandidateIds = policy.assignedCandidateIds.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
          const assignedToStudent =
            (assignedClasses.length === 0 && assignedCandidateIds.length === 0) ||
            assignedClasses.includes(normalizedCandidateClass) ||
            assignedCandidateIds.includes(normalizedCandidateId.trim().toLowerCase());
          const hiddenByStudent = snapshot.studentExamStates.some(
            (entry) => entry.examId === exam.id && entry.candidateId === normalizedCandidateId
          );
          const completedSubmission = snapshot.submissions.find(
            (submission) => submission.examId === exam.id && submission.candidateId === normalizedCandidateId
          );
          const canStartNow = hasReachedAvailabilityStart(policy.availableFrom) && !isPastAvailabilityEnd(policy.availableUntil);
          const expiredByTeacher = isPastAvailabilityEnd(policy.availableUntil);

          if (!assignedToStudent || hiddenByStudent || expiredByTeacher) {
            return null;
          }

          return {
            exam,
            completedSubmission,
            policy,
            canStartNow
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <motion.div key="student-portal" {...animation} className="mx-auto max-w-6xl space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="relative overflow-hidden bg-slate-950 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.35),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.24),transparent_26%)]" />
          <div className="relative space-y-5">
            <Badge className="bg-white/10 text-white">Student profile</Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Find the exams assigned to you, then begin.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Only exam information assigned to your class or student ID is shown here. Completed exams remain visible but cannot be started again.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="bg-white text-slate-950 hover:bg-slate-100" onClick={() => navigate("/")}>
                <ArrowLeft className="size-4" />
                Change profile
              </Button>
              <Badge className="bg-teal-100 text-teal-950">{snapshot.exams.length} exam(s) available</Badge>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 bg-gradient-to-b from-white to-teal-50 text-slate-950 dark:text-slate-950">
          <CardTitle className="text-slate-950 dark:text-slate-950">Before you start</CardTitle>
          <div className="space-y-3 text-sm text-slate-950">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950">Enter your name, candidate ID, and class exactly as assigned by your teacher or school.</div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950">Only matching exams will appear. If you already completed one, it will be grayed out and locked.</div>
            {!isSecureSessionReady(snapshot) ? (
              <div className={`rounded-2xl border px-4 py-3 ${canUseTestingMode(snapshot) ? "border-amber-200 bg-amber-50 text-amber-950" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                {canUseTestingMode(snapshot)
                  ? `${testingModeLabel(snapshot)} is active on this device. Your invigilator may still allow the session to proceed.`
                  : "This workstation still needs teacher setup before a secure exam can begin."}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
                This workstation is ready for secure exam launch.
              </div>
            )}
          </div>
        </Card>
      </section>

      {launchFeedback ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${feedbackTone(launchFeedback.tone)}`}>{launchFeedback.text}</div>
      ) : null}

      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Student details</CardTitle>
            <CardDescription>Use these details to load the exams assigned to this student or class.</CardDescription>
          </div>
          <Badge className={identifiedCandidate ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}>
            {identifiedCandidate ? `${assignedExamCards.length} assigned exam(s)` : "Enter details to continue"}
          </Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <LabelledField label="Student name">
            <Input value={candidateName} onChange={(event) => setCandidateName(event.target.value)} />
          </LabelledField>
          <LabelledField label="Candidate ID">
            <Input value={candidateId} onChange={(event) => setCandidateId(event.target.value)} />
          </LabelledField>
          <LabelledField label="Class">
            <Input value={candidateClassName} onChange={(event) => setCandidateClassName(event.target.value)} />
          </LabelledField>
        </div>
      </Card>

      <section className="grid gap-4">
        {!identifiedCandidate ? (
          <Card className="space-y-3">
            <CardTitle>Enter student details first</CardTitle>
            <CardDescription>The student portal only shows exams assigned to the current student or class.</CardDescription>
          </Card>
        ) : assignedExamCards.length === 0 ? (
          <Card className="space-y-3">
            <CardTitle>No assigned exams found</CardTitle>
            <CardDescription>There are no active exams assigned to this student or class right now.</CardDescription>
          </Card>
        ) : (
          assignedExamCards.map(({ exam, completedSubmission, policy, canStartNow }) => (
            <Card
              key={exam.id}
              className={`grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center ${
                completedSubmission || !canStartNow
                  ? "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  : ""
              }`}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{exam.title || "Untitled exam"}</CardTitle>
                  <Badge className={exam.mode === "link" ? "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100" : "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-100"}>
                    {exam.mode === "link" ? "Hosted exam" : "App exam"}
                  </Badge>
                  {completedSubmission ? <Badge className="bg-slate-800 text-white">Completed</Badge> : null}
                </div>
                <CardDescription>
                  {[
                    exam.branding.schoolName || "School not set",
                    exam.subject || "Subject not set",
                    exam.className || "Class not set",
                    exam.form ? `Form ${exam.form}` : null,
                    `${exam.durationMinutes} minutes`
                  ]
                    .filter(Boolean)
                    .join(" - ")}
                </CardDescription>
                {exam.instructions ? (
                  <div className="text-sm text-slate-900 dark:text-slate-100">{exam.instructions}</div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {policy.assignedClassNames.length > 0 ? (
                    <Badge className="bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100">Classes: {policy.assignedClassNames.join(", ")}</Badge>
                  ) : null}
                  {policy.assignedCandidateIds.length > 0 ? (
                    <Badge className="bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100">Assigned IDs: {policy.assignedCandidateIds.join(", ")}</Badge>
                  ) : null}
                  {formatDateTime(policy.availableUntil) ? (
                    <Badge className="bg-amber-100 text-amber-900">Visible until {formatDateTime(policy.availableUntil)}</Badge>
                  ) : null}
                  {!canStartNow && formatDateTime(policy.availableFrom) ? (
                    <Badge className="bg-blue-100 text-blue-900">Available from {formatDateTime(policy.availableFrom)}</Badge>
                  ) : null}
                </div>
                {completedSubmission ? (
                  <div className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                    Submitted on {new Date(completedSubmission.submittedAt).toLocaleString()}. This exam cannot be started again.
                  </div>
                ) : !canStartNow ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    This exam has been assigned to you, but it cannot be started until {formatDateTime(policy.availableFrom) ?? "the scheduled release time"}.
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => {
                    setSelectedExam(exam);
                    setExamStartCodeAttempt("");
                    setExamStartCodeError(null);
                    setLaunchFeedback(null);
                  }}
                  disabled={Boolean(completedSubmission) || !canStartNow}
                >
                  {completedSubmission ? "Already completed" : !canStartNow ? "Not yet available" : "Log in and start"}
                </Button>
                {completedSubmission && policy.allowStudentDeletionAfterCompletion ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void hideExamForStudent({ examId: exam.id, candidateId: normalizedCandidateId });
                    }}
                  >
                    Remove from my list
                  </Button>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </section>

      {selectedExam && identifiedCandidate ? (
        <Card className="border-slate-200 bg-white text-slate-950 dark:border-slate-200 dark:bg-white dark:text-slate-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="text-slate-950 dark:text-slate-950">Student login</CardTitle>
              <CardDescription className="max-w-2xl text-slate-900 dark:text-slate-900">
                Confirm your details to begin <span className="font-semibold">{selectedExam.title || "this exam"}</span>.
              </CardDescription>
            </div>
            <div className="grid w-full gap-4 md:max-w-3xl md:grid-cols-3">
              <LabelledField label="Student name" labelClassName="text-slate-800 dark:text-slate-800">
                <Input value={candidateName} onChange={(event) => setCandidateName(event.target.value)} />
              </LabelledField>
              <LabelledField label="Candidate ID" labelClassName="text-slate-800 dark:text-slate-800">
                <Input value={candidateId} onChange={(event) => setCandidateId(event.target.value)} />
              </LabelledField>
              <LabelledField label="Class" labelClassName="text-slate-800 dark:text-slate-800">
                <Input value={candidateClassName} onChange={(event) => setCandidateClassName(event.target.value)} />
              </LabelledField>
            </div>
            {hasExamStartCode(getConfigPackageForExam(snapshot, selectedExam.id)?.studentAccessPolicy) ? (
              <div className="w-full max-w-md space-y-2">
                <LabelledField label="Exam start code" labelClassName="text-slate-800 dark:text-slate-800">
                  <Input
                    type="password"
                    value={examStartCodeAttempt}
                    onChange={(event) => {
                      setExamStartCodeAttempt(event.target.value);
                      setExamStartCodeError(null);
                    }}
                    placeholder="Enter teacher-provided code"
                  />
                </LabelledField>
                {getConfigPackageForExam(snapshot, selectedExam.id)?.studentAccessPolicy.startCodeHint ? (
                  <div className="text-sm font-medium text-slate-800">
                    Hint: {getConfigPackageForExam(snapshot, selectedExam.id)?.studentAccessPolicy.startCodeHint}
                  </div>
                ) : null}
                {examStartCodeError ? <div className="text-sm font-semibold text-rose-700">{examStartCodeError}</div> : null}
              </div>
            ) : null}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setSelectedExam(null)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  const candidate = normalizeCandidate(candidateName, candidateId, candidateClassName || selectedExam.className);
                  const launched = await launchExam(selectedExam, candidate);
                  if (launched) {
                    setSelectedExam(null);
                  }
                }}
                disabled={candidateName.trim().length === 0}
              >
                Start exam
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </motion.div>
  );
};

const DashboardPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { snapshot, deleteExam, launchAlternateDesktopSession } = useLockedscreenStore();
  const [launchReviewExam, setLaunchReviewExam] = useState<Exam | null>(null);
  const [launchCandidateExam, setLaunchCandidateExam] = useState<Exam | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [launchFeedback, setLaunchFeedback] = useState<ActionFeedback | null>(null);

  if (!snapshot) {
    return null;
  }

  const openCandidatePrompt = (exam: Exam) => {
    setLaunchCandidateExam(exam);
    setCandidateName("");
    setCandidateId("");
    setLaunchReviewExam(null);
    setLaunchFeedback(null);
  };

  useEffect(() => {
    const examId = new URLSearchParams(location.search).get("launchExamId");
    if (!examId) {
      return;
    }

    const exam = snapshot.exams.find((candidate) => candidate.id === examId);
    if (exam) {
      openCandidatePrompt(exam);
    }

    navigate("/teacher", { replace: true });
  }, [location.search, navigate, snapshot]);

  const launchExam = async (exam: Exam, candidate: Candidate) => {
    setLaunchFeedback(null);

    if (!isSecureSessionReady(snapshot) && !canUseTestingMode(snapshot)) {
      setLaunchReviewExam(exam);
      return;
    }

    if (isNativeFullKioskExam(snapshot, exam.id)) {
      try {
        const handedOff = await launchAlternateDesktopSession({ examId: exam.id, candidate });
        if (handedOff) {
          return;
        }
      } catch (error) {
        setLaunchFeedback({
          tone: "error",
          text:
            error instanceof Error
              ? `${error.message} This full-kiosk exam cannot start until native Windows lockdown is active.`
              : "Native lockdown launch failed. This full-kiosk exam cannot start until the Windows lockdown companion is active."
        });
        return;
      }
    }

    navigate(buildExamRoute(exam, candidate));
  };

  return (
    <motion.div key="dashboard" {...animation} className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="relative overflow-hidden bg-slate-950 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.35),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.25),transparent_24%)]" />
          <div className="relative space-y-6">
            <Badge className="bg-white/10 text-white">Teacher Dashboard</Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Secure examinations, prepared for real deployment.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Build app-based exams, supervise linked LMS sessions, export results, and document the Windows kiosk posture for each device.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="bg-white text-slate-950 hover:bg-slate-100" onClick={() => navigate("/teacher/builder/new")}>
                <Plus className="size-4" />
                New exam
              </Button>
              <Button variant="ghost" className="bg-white/10 text-white hover:bg-white/20" onClick={() => navigate("/teacher/import")}>
                <FileInput className="size-4" />
                Import questions
              </Button>
            </div>
          </div>
        </Card>

        <Card className="bg-gradient-to-b from-white to-teal-50 text-slate-950 dark:text-slate-950">
          <CardTitle className="text-slate-950 dark:text-slate-950">Workspace summary</CardTitle>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <StatCard label="Saved exams" value={String(snapshot.exams.length)} />
            <StatCard label="Submissions" value={String(snapshot.submissions.length)} />
            <StatCard label="Approved domains" value={String(snapshot.settings.approvedDomains.length)} />
            <StatCard
              label="Kiosk posture"
              value={
                isSecureSessionReady(snapshot)
                  ? "Configured"
                  : snapshot.runtime?.canOnlyUseTestingMode
                    ? "Home testing only"
                    : "Needs setup"
              }
            />
          </div>
        </Card>
      </section>

      {launchFeedback ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${feedbackTone(launchFeedback.tone)}`}>{launchFeedback.text}</div>
      ) : null}

      <section className="grid gap-4">
        {snapshot.exams.map((exam) => (
          <Card key={exam.id} className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{exam.title || "Untitled exam"}</CardTitle>
                <Badge className={exam.mode === "link" ? "bg-blue-100 text-blue-700" : "bg-teal-100 text-teal-700"}>
                  {exam.mode === "link" ? "Link-based" : "App-based"}
                </Badge>
              </div>
              <CardDescription>
                {[
                  exam.branding.schoolName || "School pending",
                  exam.subject || "Subject pending",
                  exam.className || "Class pending",
                  exam.form ? `Form ${exam.form}` : null,
                  `${exam.durationMinutes} minutes`
                ]
                  .filter(Boolean)
                  .join(" - ")}
              </CardDescription>
              <div className="text-sm text-slate-800 dark:text-slate-100">
                {exam.mode === "app"
                  ? `${exam.questions.length} questions ready for auto-grading`
                  : exam.linkConfig?.url || "External exam URL not set"}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => navigate(`/teacher/builder/${exam.id}`)}>
                Edit
              </Button>
              <Button onClick={() => openCandidatePrompt(exam)}>
                {isSecureSessionReady(snapshot)
                  ? "Launch secure session"
                  : canUseTestingMode(snapshot)
                    ? "Launch testing session"
                    : "Launch secure session"}
              </Button>
              <Button variant="ghost" className="text-rose-700 hover:bg-rose-50" onClick={() => void deleteExam(exam.id)}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          </Card>
        ))}
      </section>

      {launchReviewExam ? (
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                <AlertTriangle className="size-5" />
              </div>
              <div className="space-y-2">
                <CardTitle>{canUseTestingMode(snapshot) ? "Non-kiosk launch warning" : "Secure launch blocked"}</CardTitle>
                <CardDescription className="max-w-3xl text-amber-900">
                  {launchReviewExam.title || "This exam"}{" "}
                  {canUseTestingMode(snapshot)
                    ? testingModeCopy(snapshot)
                    : "cannot start until the device is configured with a verified native Windows lockdown companion or official Windows kiosk deployment. The app will not pretend to suppress the Windows key or system task switching on its own."}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-3">
              {canUseTestingMode(snapshot) ? (
                <Button
                  onClick={() => openCandidatePrompt(launchReviewExam)}
                >
                  {snapshot.runtime?.canOnlyUseTestingMode ? "Launch Windows Home session" : "Launch testing session"}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => navigate("/teacher/settings")}>
                Review settings
              </Button>
              <Button variant="ghost" className="text-amber-800 hover:bg-amber-100" onClick={() => setLaunchReviewExam(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {launchCandidateExam ? (
        <Card className="border-slate-200 bg-white text-slate-950 dark:border-slate-200 dark:bg-white dark:text-slate-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <CardTitle className="text-slate-950 dark:text-slate-950">Candidate details</CardTitle>
              <CardDescription className="max-w-2xl text-slate-900 dark:text-slate-900">
                Enter the student name and optional candidate ID before launching{" "}
                {launchCandidateExam.title || "this exam"}.
              </CardDescription>
            </div>
            <div className="grid w-full gap-4 md:max-w-xl md:grid-cols-2">
              <LabelledField label="Student name" labelClassName="text-slate-800 dark:text-slate-800">
                <Input value={candidateName} onChange={(event) => setCandidateName(event.target.value)} />
              </LabelledField>
              <LabelledField label="Candidate ID" labelClassName="text-slate-800 dark:text-slate-800">
                <Input value={candidateId} onChange={(event) => setCandidateId(event.target.value)} />
              </LabelledField>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setLaunchCandidateExam(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const candidate = normalizeCandidate(candidateName, candidateId, launchCandidateExam.className);
                  void launchExam(launchCandidateExam, candidate);
                  setLaunchCandidateExam(null);
                }}
                disabled={candidateName.trim().length === 0}
              >
                Continue
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </motion.div>
  );
};

const BuilderPage = () => {
  const navigate = useNavigate();
  const { examId } = useParams();
  const { snapshot, saveExam } = useLockedscreenStore();
  const existing = snapshot?.exams.find((exam) => exam.id === examId);
  const [draft, setDraft] = useState<Exam>(() => existing ?? blankExam());

  useEffect(() => {
    setDraft(existing ?? blankExam());
  }, [existing, examId]);

  const updateDraft = (patch: Partial<Exam>) => setDraft((current) => ({ ...current, ...patch }));

  const saveCurrent = async () => {
    await saveExam({ ...draft, updatedAt: new Date().toISOString() });
    navigate("/teacher");
  };

  return (
    <motion.div key={`builder-${examId}`} {...animation} className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{existing ? "Edit exam" : "Create exam"}</h1>
          <p className="mt-2 text-sm text-slate-800 dark:text-slate-100">
            Configure teacher settings, compose questions, and preview the student-facing environment.
          </p>
        </div>
        <Button onClick={() => void saveCurrent()}>
          <Save className="size-4" />
          Save exam
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField label="Exam title">
              <Input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
            </LabelledField>
            <LabelledField label="Mode">
              <select
                className={selectClassName}
                value={draft.mode}
                onChange={(event) =>
                  updateDraft({
                    mode: event.target.value === "link" ? "link" : "app",
                    linkConfig:
                      event.target.value === "link"
                        ? draft.linkConfig ?? { url: "", allowedDomains: [] }
                        : undefined
                  })
                }
              >
                <option value="app">App-based exam</option>
                <option value="link">Link-based exam</option>
              </select>
            </LabelledField>
            <LabelledField label="Subject">
              <Input value={draft.subject} onChange={(event) => updateDraft({ subject: event.target.value })} />
            </LabelledField>
            <LabelledField label="Class">
              <Input value={draft.className} onChange={(event) => updateDraft({ className: event.target.value })} />
            </LabelledField>
            <LabelledField label="Form">
              <Input value={draft.form} onChange={(event) => updateDraft({ form: event.target.value })} />
            </LabelledField>
            <LabelledField label="School">
              <Input
                value={draft.branding.schoolName}
                onChange={(event) =>
                  updateDraft({
                    branding: { ...draft.branding, schoolName: event.target.value }
                  })
                }
              />
            </LabelledField>
            <LabelledField label="Duration (minutes)">
              <Input
                type="number"
                min={5}
                value={draft.durationMinutes}
                onChange={(event) => updateDraft({ durationMinutes: Number(event.target.value) || 0 })}
              />
            </LabelledField>
            <LabelledField label="Accent color">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  className="h-11 w-14 rounded-2xl border border-slate-200 bg-white p-1"
                  value={draft.branding.accentColor}
                  onChange={(event) =>
                    updateDraft({
                      branding: { ...draft.branding, accentColor: event.target.value }
                    })
                  }
                />
                <Input
                  value={draft.branding.accentColor}
                  onChange={(event) =>
                    updateDraft({
                      branding: { ...draft.branding, accentColor: event.target.value }
                    })
                  }
                />
              </div>
            </LabelledField>
            <LabelledField label="Theme">
              <div className="grid grid-cols-3 gap-2">
                {(["light", "dark", "system"] as const).map((theme) => (
                  <Button
                    key={theme}
                    variant={draft.appearance.theme === theme ? "primary" : "secondary"}
                    className="capitalize"
                    onClick={() => updateDraft({ appearance: { ...draft.appearance, theme } })}
                  >
                    {theme === "light" ? (
                      <Sun className="size-4" />
                    ) : theme === "dark" ? (
                      <Moon className="size-4" />
                    ) : (
                      <Settings className="size-4" />
                    )}
                    {theme}
                  </Button>
                ))}
              </div>
            </LabelledField>
            <LabelledField label="Layout density">
              <select
                className={selectClassName}
                value={draft.appearance.density}
                onChange={(event) =>
                  updateDraft({
                    appearance: {
                      ...draft.appearance,
                      density: event.target.value === "compact" ? "compact" : "comfortable"
                    }
                  })
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </LabelledField>
          </div>

          <LabelledField label="Instructions">
            <Textarea value={draft.instructions} onChange={(event) => updateDraft({ instructions: event.target.value })} />
          </LabelledField>

          {draft.mode === "link" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <LabelledField label="Exam URL">
                <Input
                  placeholder="https://docs.google.com/forms/..."
                  value={draft.linkConfig?.url ?? ""}
                  onChange={(event) =>
                    updateDraft({
                      linkConfig: {
                        url: event.target.value,
                        allowedDomains: draft.linkConfig?.allowedDomains ?? []
                      }
                    })
                  }
                />
              </LabelledField>
              <LabelledField label="Allowed domains">
                <Textarea
                  className="min-h-[96px]"
                  placeholder={"docs.google.com\nclassroom.google.com"}
                  value={(draft.linkConfig?.allowedDomains ?? []).join("\n")}
                  onChange={(event) =>
                    updateDraft({
                      linkConfig: {
                        url: draft.linkConfig?.url ?? "",
                        allowedDomains: event.target.value
                          .split(/\r?\n/)
                          .map((domain) => domain.trim())
                          .filter(Boolean)
                      }
                    })
                  }
                />
              </LabelledField>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6">
          {draft.mode === "app" ? <QuestionBuilder draft={draft} setDraft={setDraft} /> : null}
          <ExamPreviewCard exam={draft} />
        </div>
      </div>
    </motion.div>
  );
};

const QuestionBuilder = ({
  draft,
  setDraft
}: {
  draft: Exam;
  setDraft: Dispatch<SetStateAction<Exam>>;
}) => {
  const addQuestion = () => setDraft((current) => ({ ...current, questions: [...current.questions, blankQuestion()] }));

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>Question builder</CardTitle>
          <CardDescription>Use the editor toolbar for text styling, equations, fractions, powers, division, lists, and images.</CardDescription>
        </div>
        <Button onClick={addQuestion}>
          <Plus className="size-4" />
          Add question
        </Button>
      </div>

      <div className="space-y-4">
        {draft.questions.map((question, index) => (
          <QuestionEditor
            key={question.id}
            question={question}
            index={index}
            total={draft.questions.length}
            onChange={(nextQuestion) =>
              setDraft((current) => ({
                ...current,
                questions: current.questions.map((candidate) => (candidate.id === question.id ? nextQuestion : candidate))
              }))
            }
            onDelete={() =>
              setDraft((current) => ({
                ...current,
                questions: current.questions.filter((candidate) => candidate.id !== question.id)
              }))
            }
            onMove={(direction) => {
              setDraft((current) => {
                const clone = [...current.questions];
                const from = index;
                const to = direction === "up" ? index - 1 : index + 1;
                if (to < 0 || to >= clone.length) {
                  return current;
                }

                const [item] = clone.splice(from, 1);
                if (!item) {
                  return current;
                }

                clone.splice(to, 0, item);
                return {
                  ...current,
                  questions: clone
                };
              });
            }}
            onDuplicate={() =>
              setDraft((current) => {
                const nextOptions = question.options.map((option) => ({ ...option, id: crypto.randomUUID() }));
                const correctLabel =
                  question.options.find((option) => option.id === question.correctOptionId)?.label ?? question.options[0]?.label;
                const firstNextOption = nextOptions.at(0);
                if (!firstNextOption) {
                  return current;
                }

                const duplicated = {
                  ...question,
                  id: crypto.randomUUID(),
                  options: nextOptions,
                  correctOptionId: nextOptions.find((option) => option.label === correctLabel)?.id ?? firstNextOption.id
                };

                return {
                  ...current,
                  questions: [
                    ...current.questions.slice(0, index + 1),
                    duplicated,
                    ...current.questions.slice(index + 1)
                  ]
                };
              })
            }
          />
        ))}
      </div>
    </Card>
  );
};

const QuestionEditor = ({
  question,
  index,
  total,
  onChange,
  onDelete,
  onMove,
  onDuplicate
}: {
  question: Question;
  index: number;
  total: number;
  onChange: (nextQuestion: Question) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
}) => {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge>Question {index + 1}</Badge>
          <span className="text-sm text-slate-900">{total} total</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onMove("up")} disabled={index === 0}>
            Up
          </Button>
          <Button variant="secondary" onClick={() => onMove("down")} disabled={index === total - 1}>
            Down
          </Button>
          <Button variant="secondary" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="ghost" className="text-rose-700 hover:bg-rose-100" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <RichContentEditor
          value={question.prompt}
          onChange={(prompt) => onChange({ ...question, prompt })}
          placeholder="Write the prompt."
          textareaClassName="min-h-[156px]"
          previewClassName="text-base"
        />
        <div className="grid gap-3 md:grid-cols-2">
          {question.options.map((option) => (
            <div key={option.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Option {option.label}</span>
                <input
                  type="radio"
                  name={`correct-${question.id}`}
                  checked={question.correctOptionId === option.id}
                  onChange={() => onChange({ ...question, correctOptionId: option.id })}
                />
              </div>
              <RichContentEditor
                value={option.content}
                onChange={(content) =>
                  onChange({
                    ...question,
                    options: question.options.map((candidate) =>
                      candidate.id === option.id ? { ...candidate, content } : candidate
                    )
                  })
                }
                placeholder={`Option ${option.label}`}
                textareaClassName="min-h-[88px]"
                previewClassName="min-h-[56px]"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
const ImportPage = () => {
  const navigate = useNavigate();
  const { snapshot, activeImport, importQuestions, exportQuestionTemplate, saveExam } = useLockedscreenStore();
  const [targetExamId, setTargetExamId] = useState<string>("new");
  const [reviewMetadata, setReviewMetadata] = useState<ImportedExamMetadata | null>(null);
  const [reviewQuestions, setReviewQuestions] = useState<ImportedQuestionDraft[]>([]);
  const [templateSavedPath, setTemplateSavedPath] = useState<string | null>(null);
  const [importPending, setImportPending] = useState(false);

  useEffect(() => {
    const nextReview = hydrateImportReview(activeImport);
    setReviewMetadata(nextReview.metadata);
    setReviewQuestions(nextReview.questions);
  }, [activeImport]);

  const unresolvedAnswerCount = reviewQuestions.filter((question) => !question.selectedCorrectOptionId).length;
  const canApplyImport = Boolean(reviewMetadata && reviewQuestions.length > 0 && unresolvedAnswerCount === 0);

  const updateMetadata = (patch: Partial<ImportedExamMetadata>) => {
    setReviewMetadata((current) => (current ? { ...current, ...patch } : current));
  };

  const updateQuestion = (questionId: string, updater: (question: ImportedQuestionDraft) => ImportedQuestionDraft) => {
    setReviewQuestions((current) =>
      current.map((question) => (question.id === questionId ? updater(question) : question))
    );
  };

  const handleExportTemplate = async () => {
    const filePath = await exportQuestionTemplate();
    if (filePath) {
      setTemplateSavedPath(filePath);
    }
  };

  const handleImportQuestions = async () => {
    setImportPending(true);
    try {
      await importQuestions();
    } finally {
      setImportPending(false);
    }
  };

  const applyImport = async () => {
    if (!reviewMetadata || reviewQuestions.length === 0 || unresolvedAnswerCount > 0) {
      return;
    }

    const importedQuestions: Question[] = reviewQuestions.map((question) => ({
      id: question.id,
      type: "multiple-choice",
      prompt: question.prompt.trim(),
      points: question.points,
      options: question.options.map((option) => ({ ...option })),
      correctOptionId: question.selectedCorrectOptionId ?? ""
    }));

    if (targetExamId === "new") {
      const exam = blankExam("app");
      exam.title = reviewMetadata.title.trim() || "Imported exam";
      exam.subject = reviewMetadata.subject.trim();
      exam.className = reviewMetadata.className.trim();
      exam.form = reviewMetadata.form.trim();
      exam.instructions = reviewMetadata.instructions.trim() || exam.instructions;
      exam.durationMinutes = reviewMetadata.durationMinutes ?? 45;
      exam.branding = {
        ...exam.branding,
        schoolName: reviewMetadata.schoolName.trim()
      };
      exam.questions = importedQuestions;
      await saveExam(exam);
      navigate(`/teacher/builder/${exam.id}`);
      return;
    }

    const target = snapshot?.exams.find((exam) => exam.id === targetExamId);
    if (!target) {
      return;
    }

    await saveExam({ ...target, questions: [...target.questions, ...importedQuestions] });
    navigate(`/teacher/builder/${target.id}`);
  };

  return (
    <motion.div key="import" {...animation} className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Import questions</h1>
        <p className="mt-2 text-sm text-slate-800 dark:text-slate-100">
          Upload `.doc`, `.docx`, `.pdf`, `.txt`, or scanned image exam papers, review the extracted heading and metadata, then select the correct option for each question before saving.
        </p>
      </div>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>Teacher import format guide</CardTitle>
            <CardDescription>
              The importer reads document text, uses OCR for scans, and keeps supported HTML and LaTeX notation for review.
            </CardDescription>
          </div>
          <Button variant="secondary" onClick={() => void handleExportTemplate()}>
            <Download className="size-4" />
            Download sample template
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">Classic format</div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-sm leading-6 text-slate-800 dark:bg-slate-950 dark:text-slate-100">{`Q1. Simplify \\(\\frac{3}{4} \\div 2\\).
A. \\(\\frac{3}{2}\\)
B. \\(\\frac{3}{8}\\)
C. \\(\\frac{4}{3}\\)
D. \\(\\frac{8}{3}\\)
ANS: B`}</pre>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">Tagged format</div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-sm leading-6 text-slate-800 dark:bg-slate-950 dark:text-slate-100">{`[QUESTION]
Which formula represents water?
[OPTION]
A. HO
[OPTION]
B. H<sub>2</sub>O
[ANSWER]
B
[/QUESTION]`}</pre>
          </div>
        </div>

        <div className="grid gap-3 text-sm text-slate-900 dark:text-slate-100 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="font-semibold text-slate-950 dark:text-slate-50">Questions: </span>
            Start with `Q1.`, `1.`, or `Question:`.
          </div>
          <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="font-semibold text-slate-950 dark:text-slate-50">Options: </span>
            Use one option per line with labels such as `A.`, `B.`, `C.`, and `D.`.
          </div>
          <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="font-semibold text-slate-950 dark:text-slate-50">Answers: </span>
            Use `ANS: B`, `Answer: B`, or `[ANSWER]` followed by the option key.
          </div>
          <div className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className="font-semibold text-slate-950 dark:text-slate-50">Formatting: </span>
            Use `\(...\)`, `$$...$$`, `&lt;sup&gt;`, `&lt;sub&gt;`, and embedded images.
          </div>
        </div>

        <div className="text-sm text-slate-800 dark:text-slate-100">
          Header labels such as `Title:`, `Subject:`, `Class:`, `Form:`, `Duration:`, and `Instructions:` are
          copied into the exam details for teacher review before saving. OCR works best with straight, high-contrast
          scans that still use the question and option labels shown above.
        </div>

        {templateSavedPath ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Sample template saved to {templateSavedPath}
          </div>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void handleImportQuestions()} disabled={importPending}>
          <FileInput className="size-4" />
          {importPending ? "Importing..." : "Choose import file"}
        </Button>
        <select
          className={selectClassName}
          value={targetExamId}
          onChange={(event) => setTargetExamId(event.target.value)}
        >
          <option value="new">Create new exam</option>
          {snapshot?.exams
            .filter((exam) => exam.mode === "app")
            .map((exam) => (
              <option key={exam.id} value={exam.id}>
                Append to {exam.title || "Untitled exam"}
              </option>
            ))}
        </select>
        <Button variant="secondary" onClick={() => void applyImport()} disabled={!canApplyImport}>
          {unresolvedAnswerCount > 0 ? `Select ${unresolvedAnswerCount} answer${unresolvedAnswerCount === 1 ? "" : "s"}` : "Save import"}
        </Button>
      </div>

      {importPending ? (
        <Card className="border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-100">
          <div className="flex items-start gap-3">
            <div className="mt-1 size-3 animate-pulse rounded-full bg-blue-600" />
            <div>
              <CardTitle>Import in progress</CardTitle>
              <CardDescription className="text-blue-900 dark:text-blue-100">
                Reading the selected file. Scanned PDFs and image files may take longer while OCR converts them to text.
              </CardDescription>
            </div>
          </div>
        </Card>
      ) : null}

      {activeImport && reviewMetadata ? (
        <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-6">
            <Card className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Exam details</CardTitle>
                  <CardDescription>
                    Review the extracted heading, subject, class, form, and timing before saving.
                  </CardDescription>
                </div>
                <Badge>{activeImport.sourceFileName}</Badge>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <LabelledField label="Heading">
                  <Input value={reviewMetadata.title} onChange={(event) => updateMetadata({ title: event.target.value })} />
                </LabelledField>
                <LabelledField label="Subject">
                  <Input value={reviewMetadata.subject} onChange={(event) => updateMetadata({ subject: event.target.value })} />
                </LabelledField>
                <LabelledField label="Class">
                  <Input value={reviewMetadata.className} onChange={(event) => updateMetadata({ className: event.target.value })} />
                </LabelledField>
                <LabelledField label="Form">
                  <Input value={reviewMetadata.form} onChange={(event) => updateMetadata({ form: event.target.value })} />
                </LabelledField>
                <LabelledField label="Teacher">
                  <Input
                    value={reviewMetadata.teacherName}
                    onChange={(event) => updateMetadata({ teacherName: event.target.value })}
                  />
                </LabelledField>
                <LabelledField label="School">
                  <Input
                    value={reviewMetadata.schoolName}
                    onChange={(event) => updateMetadata({ schoolName: event.target.value })}
                  />
                </LabelledField>
                <LabelledField label="Detected time">
                  <Input
                    value={reviewMetadata.durationText}
                    onChange={(event) => updateMetadata({ durationText: event.target.value })}
                    placeholder="e.g. 1 hour 30 minutes"
                  />
                </LabelledField>
                <LabelledField label="Duration (minutes)">
                  <Input
                    type="number"
                    min={1}
                    value={reviewMetadata.durationMinutes ?? 45}
                    onChange={(event) =>
                      updateMetadata({
                        durationMinutes: Number(event.target.value) || 45
                      })
                    }
                  />
                </LabelledField>
              </div>

              <LabelledField label="Instructions">
                <Textarea
                  className="min-h-[120px]"
                  value={reviewMetadata.instructions}
                  onChange={(event) => updateMetadata({ instructions: event.target.value })}
                  placeholder="Any instructions extracted from the uploaded document appear here."
                />
              </LabelledField>
            </Card>

            <Card className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Import notes</CardTitle>
                <Badge>{reviewQuestions.length} questions</Badge>
              </div>
              <div className="space-y-3">
                {activeImport.extraction?.usedOcr ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    OCR was used for this import. Review every question, option label, and answer carefully because scan
                    quality can change letters or numbers.
                    {activeImport.extraction.pageLimitReached && activeImport.extraction.maxPages ? (
                      <span> OCR stopped after {activeImport.extraction.maxPages} pages.</span>
                    ) : null}
                  </div>
                ) : null}
                {activeImport.issues.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    The document structure was extracted cleanly.
                  </div>
                ) : (
                  activeImport.issues.map((issue, index) => (
                    <div
                      key={`${issue.message}-${index}`}
                      className={`rounded-2xl border px-4 py-3 text-sm ${
                        issue.severity === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      }`}
                    >
                      {issue.message}
                    </div>
                  ))
                )}
                {unresolvedAnswerCount > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Select the correct option for every imported question before saving this exam.
                  </div>
                ) : null}
              </div>
            </Card>
          </div>

          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Question review</CardTitle>
                <CardDescription>
                  Edit any extracted text that needs cleanup and choose the correct answer for each question.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{reviewQuestions.length} items</Badge>
                <Badge className={unresolvedAnswerCount > 0 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}>
                  {unresolvedAnswerCount > 0 ? `${unresolvedAnswerCount} pending answers` : "Ready to save"}
                </Badge>
              </div>
            </div>

            <div className="space-y-4">
              {reviewQuestions.map((question, index) => (
                <ImportedQuestionReviewCard
                  key={question.id}
                  question={question}
                  index={index}
                  onChange={(nextQuestion) => updateQuestion(question.id, () => nextQuestion)}
                  onDelete={() =>
                    setReviewQuestions((current) => current.filter((candidate) => candidate.id !== question.id))
                  }
                />
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="space-y-3">
          <CardTitle>Ready to import</CardTitle>
            <CardDescription>
            Choose an exam document or scan to extract the heading, class, subject, form, time, questions, and answer options into a review screen.
          </CardDescription>
        </Card>
      )}
    </motion.div>
  );
};

const ImportedQuestionReviewCard = ({
  question,
  index,
  onChange,
  onDelete
}: {
  question: ImportedQuestionDraft;
  index: number;
  onChange: (question: ImportedQuestionDraft) => void;
  onDelete: () => void;
}) => {
  const detectedOption = question.detectedAnswerLabel
    ? question.options.find((option) => option.label === question.detectedAnswerLabel)
    : null;

  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Question {index + 1}</Badge>
          {detectedOption ? (
            <Badge className="bg-blue-100 text-blue-900">Detected answer {detectedOption.label}</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-900">Teacher answer required</Badge>
          )}
        </div>
        <Button variant="ghost" className="text-rose-700 hover:bg-rose-100" onClick={onDelete}>
          Remove
        </Button>
      </div>

      <div className="space-y-4">
        <LabelledField label="Prompt">
          <RichContentEditor
            value={question.prompt}
            onChange={(prompt) => onChange({ ...question, prompt })}
            placeholder="Review or format the imported prompt."
            textareaClassName="min-h-[132px]"
            previewClassName="text-base"
          />
        </LabelledField>

        <div className="grid gap-3 md:grid-cols-2">
          {question.options.map((option) => (
            <div key={option.id} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Option {option.label}</span>
                <input
                  type="radio"
                  name={`import-correct-${question.id}`}
                  checked={question.selectedCorrectOptionId === option.id}
                  onChange={() => onChange({ ...question, selectedCorrectOptionId: option.id })}
                />
              </div>
              <RichContentEditor
                value={option.content}
                onChange={(content) =>
                  onChange({
                    ...question,
                    options: question.options.map((candidate) =>
                      candidate.id === option.id ? { ...candidate, content } : candidate
                    )
                  })
                }
                placeholder={`Option ${option.label}`}
                textareaClassName="min-h-[88px]"
                previewClassName="min-h-[56px]"
              />
            </div>
          ))}
        </div>

        {!question.selectedCorrectOptionId ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Select the correct option for this question before saving the imported exam.
          </div>
        ) : null}
      </div>
    </div>
  );
};

const PackageImportPage = ({ launchContext }: { launchContext: LaunchContext | null }) => {
  const navigate = useNavigate();
  const { snapshot: currentSnapshot, importConfigPackage } = useLockedscreenStore();
  const packageImport = launchContext?.packageImport ?? null;
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [importedExam, setImportedExam] = useState<Exam | null>(null);
  const importedPathRef = useRef<string | null>(null);
  const returnRoute = launchContext?.installedRole === "student" ? "/student" : "/teacher";

  useEffect(() => {
    setFeedback(null);
    setImportedExam(null);
  }, [packageImport?.filePath]);

  const handleImport = async () => {
    if (!packageImport || pending) {
      return;
    }

    setPending(true);
    setFeedback(null);

    try {
      const previousExams = new Map((currentSnapshot?.exams ?? []).map((candidate) => [candidate.id, candidate.updatedAt]));
      const importedSnapshot = await importConfigPackage({
        filePath: packageImport.filePath
      });

      if (!importedSnapshot) {
        setFeedback({
          tone: "error",
          text: "Import failed. The package could not be opened on this device."
        });
        return;
      }

      const nextExam = findImportedExam(previousExams, importedSnapshot.exams);
      setImportedExam(nextExam);
      setFeedback({
        tone: "success",
        text: nextExam
          ? `Opened "${nextExam.title || "Uploaded exam"}".`
          : "Exam package imported successfully."
      });
      if (nextExam) {
        navigate(buildDashboardLaunchRoute(nextExam.id), { replace: true });
      }
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (!packageImport || importedPathRef.current === packageImport.filePath) {
      return;
    }

    importedPathRef.current = packageImport.filePath;
    void handleImport();
  }, [packageImport?.filePath]);

  return (
    <motion.div key="package-import" {...animation} className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Open exam package</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-800 dark:text-slate-100">
          Double-clicked Lockedscreen packages import automatically and open in the student exam environment.
        </p>
      </div>

      <Card className="space-y-5">
        {packageImport ? (
          <>
            <div className="space-y-3">
              <div>
                <CardTitle>{packageImport.label}</CardTitle>
                <CardDescription>
                  {packageImport.examTitle
                    ? `This package contains the exam "${packageImport.examTitle}".`
                    : "This package was exported from Lockedscreen and is ready to open."}
                </CardDescription>
              </div>
            </div>

            {feedback ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${feedbackTone(feedback.tone)}`}>{feedback.text}</div>
            ) : null}

            {importedExam ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Uploaded exam ready: <span className="font-semibold">{importedExam.title || "Untitled exam"}</span>
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => navigate(returnRoute)}>
                Return to dashboard
              </Button>
              {importedExam ? (
                <Button onClick={() => navigate(buildDashboardLaunchRoute(importedExam.id), { replace: true })}>
                  Start uploaded exam
                </Button>
              ) : (
                <Button onClick={() => void handleImport()} disabled={pending}>
                  {pending ? "Opening..." : "Open exam package"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <CardTitle>No exam package is waiting to be opened</CardTitle>
            <CardDescription>
              Open a `.lscp` file from File Explorer or use the admin console to import a package manually.
            </CardDescription>
            <div>
              <Button onClick={() => navigate(returnRoute)}>Return to dashboard</Button>
            </div>
          </>
        )}
      </Card>
    </motion.div>
  );
};

const ResultsPage = () => {
  const { snapshot, exportResultsCsv, syncPendingResults, syncSubmissionResults } = useLockedscreenStore();

  if (!snapshot) {
    return null;
  }

  const hasPendingSync = snapshot.submissions.some((submission) =>
    submission.syncStates.some((state) => state.status === "pending" || state.status === "failed")
  );

  return (
    <motion.div key="results" {...animation} className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Results</h1>
          <p className="mt-2 text-sm text-slate-800 dark:text-slate-100">
            App-based exams auto-grade locally first, then can sync safely to Google Classroom, Microsoft Teams, Google Sheets, or another LMS endpoint from the admin side.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void syncPendingResults()} disabled={!hasPendingSync}>
            <ShieldCheck className="size-4" />
            Sync pending
          </Button>
          <Button variant="secondary" onClick={() => void exportResultsCsv()}>
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Configured destinations</CardTitle>
            <CardDescription>
              Destinations are configured in the admin console. Local submissions remain stored even if remote sync fails.
            </CardDescription>
          </div>
          <Badge>{snapshot.resultDestinations.length} destination(s)</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {snapshot.resultDestinations.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              No LMS or sheet destination configured yet.
            </div>
          ) : (
            snapshot.resultDestinations.map((destination) => (
              <div key={destination.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{destination.label}</span>
                  <Badge>{providerLabel(destination.type)}</Badge>
                  <Badge className={destination.enabled ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-900"}>
                    {destination.enabled ? destination.trigger : "disabled"}
                  </Badge>
                </div>
                <div className="mt-2 text-sm text-slate-800 dark:text-slate-100">
                  {destination.className || "All classes"} / {destination.endpointUrl || "Endpoint pending"}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="grid grid-cols-[1.2fr_1fr_0.7fr_0.8fr_1fr_auto] gap-4 border-b border-slate-200 px-1 pb-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-900">
          <span>Candidate</span>
          <span>Exam</span>
          <span>Score</span>
          <span>Percent</span>
          <span>Submitted</span>
          <span>Action</span>
        </div>
        {snapshot.submissions.length === 0 ? (
          <div className="py-10 text-sm text-slate-900 dark:text-slate-100">No submissions yet.</div>
        ) : (
          snapshot.submissions.map((result) => (
            <div key={result.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="grid grid-cols-[1.2fr_1fr_0.7fr_0.8fr_1fr_auto] gap-4 text-sm text-slate-900 dark:text-slate-100">
                <span>{result.candidateName}</span>
                <span>{result.examTitle}</span>
                <span>
                  {result.score}/{result.totalPoints}
                </span>
                <span>{result.percentage}%</span>
                <span>{new Date(result.submittedAt).toLocaleString()}</span>
                <Button variant="secondary" className="px-3 py-2" onClick={() => void syncSubmissionResults(result.id)}>
                  Sync
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.syncStates.length === 0 ? (
                  <Badge className="bg-slate-100 text-slate-900">No destinations</Badge>
                ) : (
                  result.syncStates.map((state) => (
                    <Badge key={`${result.id}-${state.destinationId}`} className={resultSyncTone(state.status)}>
                      {state.destinationLabel}: {state.status}
                    </Badge>
                  ))
                )}
                {result.studentLmsTurnIn ? (
                  <Badge className={studentTurnInTone(result.studentLmsTurnIn.status)}>
                    {providerLabel(result.studentLmsTurnIn.provider)}: {result.studentLmsTurnIn.status}
                  </Badge>
                ) : null}
                {result.studentLmsTurnIn?.gradeSyncStatus ? (
                  <Badge className={studentTurnInTone(result.studentLmsTurnIn.gradeSyncStatus)}>
                    Grade sync: {result.studentLmsTurnIn.gradeSyncStatus}
                  </Badge>
                ) : null}
              </div>
              {result.syncStates.some((state) => state.lastError) ? (
                <div className="mt-3 grid gap-2">
                  {result.syncStates
                    .filter((state) => state.lastError)
                    .map((state) => (
                      <div
                        key={`${result.id}-${state.destinationId}-error`}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      >
                        {state.destinationLabel}: {state.lastError}
                      </div>
                    ))}
                </div>
              ) : null}
              {result.studentLmsTurnIn?.lastError ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {providerLabel(result.studentLmsTurnIn.provider)}: {result.studentLmsTurnIn.lastError}
                </div>
              ) : null}
              {result.studentLmsTurnIn?.gradeSyncError ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Grade sync: {result.studentLmsTurnIn.gradeSyncError}
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>
    </motion.div>
  );
};

const SettingsPage = () => {
  const {
    snapshot,
    saveSettings,
    saveSecurityProfile,
    saveConfigPackage,
    saveResultDestination,
    saveLmsConnection,
    deleteLmsConnection,
    connectLmsConnection,
    signOutLmsConnection,
    clearLmsConnectionTokens,
    listLmsCourses,
    listLmsCourseWork,
    listLmsStudents,
    deleteResultDestination,
    deleteConfigPackage,
    duplicateConfigPackage,
    exportConfigPackage,
    publishConfigPackageToClassroom,
    importConfigPackage,
    refreshSecurityOverview
  } = useLockedscreenStore();
  const [settings, setSettings] = useState<AppSettings | null>(snapshot?.settings ?? null);
  const [security, setSecurity] = useState<SecurityProfile | null>(snapshot?.securityProfile ?? null);
  const [selectedPackageId, setSelectedPackageId] = useState(snapshot?.configPackages[0]?.id ?? "");
  const [packageDraft, setPackageDraft] = useState<ExamConfigPackage | null>(snapshot?.configPackages[0] ?? null);
  const [urlRulesText, setUrlRulesText] = useState("");
  const [allowedAppsText, setAllowedAppsText] = useState("");
  const [pendingAction, setPendingAction] = useState<AdminActionState | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [securityDirty, setSecurityDirty] = useState(false);
  const [packageDirty, setPackageDirty] = useState(false);
  const [selectedDestinationId, setSelectedDestinationId] = useState(snapshot?.resultDestinations[0]?.id ?? "");
  const [destinationDraft, setDestinationDraft] = useState<ResultDestination | null>(snapshot?.resultDestinations[0] ?? null);
  const [destinationDirty, setDestinationDirty] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState(snapshot?.lmsConnections[0]?.id ?? "");
  const [connectionDraft, setConnectionDraft] = useState<LmsConnection | null>(snapshot?.lmsConnections[0] ?? null);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [connectionCourses, setConnectionCourses] = useState<LmsCourse[]>([]);
  const [bindingCourseWork, setBindingCourseWork] = useState<LmsCourseWork[]>([]);
  const [bindingStudents, setBindingStudents] = useState<LmsStudent[]>([]);
  const [settingsUpdateState, setSettingsUpdateState] = useState<AppUpdateState | null>(initialUpdateState);
  const [adminAdvancedUnlocked, setAdminAdvancedUnlocked] = useState(false);
  const [adminPinAttempt, setAdminPinAttempt] = useState("");
  const [adminUnlockError, setAdminUnlockError] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("overview");
  const autoTestingMode = snapshot?.runtime?.canOnlyUseTestingMode === true;

  useEffect(() => {
    void window.lockedscreenApi.getUpdateState().then(setSettingsUpdateState);
    const unsubscribe = window.lockedscreenApi.onUpdateStateChanged(setSettingsUpdateState);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!snapshot) {
      setSettings(null);
      setSecurity(null);
      setSelectedPackageId("");
      setPackageDraft(null);
      setSelectedDestinationId("");
      setDestinationDraft(null);
      setSelectedConnectionId("");
      setConnectionDraft(null);
      setConnectionCourses([]);
      setBindingCourseWork([]);
      setBindingStudents([]);
      setUrlRulesText("");
      setAllowedAppsText("");
      return;
    }

    if (!settingsDirty) {
      setSettings(snapshot.settings);
    }

    if (!securityDirty) {
      setSecurity(snapshot.securityProfile);
    }

    if (snapshot.configPackages.length === 0) {
      setSelectedPackageId("");
      setPackageDraft(null);
      setUrlRulesText("");
      setAllowedAppsText("");
      return;
    }

    const selected =
      snapshot.configPackages.find((candidate) => candidate.id === selectedPackageId) ?? snapshot.configPackages[0];

    if (!packageDirty || packageDraft?.id !== selected?.id) {
      setSelectedPackageId(selected?.id ?? "");
      setPackageDraft(selected ?? null);
      setUrlRulesText(selected ? serializeUrlRules(selected.browserPolicy.urlRules) : "");
      setAllowedAppsText(selected ? serializeAllowedApps(selected) : "");
      setBindingStudents([]);
    }

    if (snapshot.resultDestinations.length === 0) {
      if (!destinationDirty) {
        setSelectedDestinationId("");
        setDestinationDraft(blankResultDestinationWithDefaults(snapshot.settings));
      }
    } else {
      const selectedDestination =
        snapshot.resultDestinations.find((candidate) => candidate.id === selectedDestinationId) ?? snapshot.resultDestinations[0];

      if (!destinationDirty || destinationDraft?.id !== selectedDestination?.id) {
        setSelectedDestinationId(selectedDestination?.id ?? "");
        setDestinationDraft(selectedDestination ?? null);
      }
    }

    if (snapshot.lmsConnections.length === 0) {
      if (!connectionDirty) {
        setSelectedConnectionId("");
        setConnectionDraft(blankLmsConnection());
        setConnectionCourses([]);
        setBindingCourseWork([]);
        setBindingStudents([]);
      }
    } else {
      const selectedConnection =
        snapshot.lmsConnections.find((candidate) => candidate.id === selectedConnectionId) ?? snapshot.lmsConnections[0];

      if (!connectionDirty || connectionDraft?.id !== selectedConnection?.id) {
        const selectedConnectionChanged = connectionDraft?.id !== selectedConnection?.id;
        setSelectedConnectionId(selectedConnection?.id ?? "");
        setConnectionDraft(selectedConnection ?? null);
        if (selectedConnectionChanged) {
          setConnectionCourses([]);
          setBindingCourseWork([]);
          setBindingStudents([]);
        }
      }
    }
  }, [
    connectionDirty,
    connectionDraft?.id,
    destinationDirty,
    destinationDraft?.id,
    packageDirty,
    packageDraft?.id,
    securityDirty,
    selectedDestinationId,
    selectedConnectionId,
    selectedPackageId,
    settingsDirty,
    snapshot
  ]);

  useEffect(() => {
    if (!snapshot || !packageDraft || packageDirty) {
      return;
    }

    const binding = packageDraft.studentLmsBinding;
    if (packageDraft.externalDeliveryMode === "lockdown-only" || binding.provider !== "google-classroom" || binding.connectionId) {
      return;
    }

    const connectedGoogleAccounts = snapshot.lmsConnections.filter(
      (connection) => connection.provider === "google-classroom" && connection.status === "connected"
    );

    if (connectedGoogleAccounts.length !== 1) {
      return;
    }

    const teacherConnection = connectedGoogleAccounts[0];
    if (!teacherConnection) {
      return;
    }
    setPackageDirty(true);
    setPackageDraft((current) =>
      current
        ? {
            ...current,
            studentLmsBinding: {
              ...current.studentLmsBinding,
              connectionId: teacherConnection.id,
              provider: "google-classroom",
              clientId: teacherConnection.clientId,
              clientSecret: teacherConnection.clientSecret,
              tenantId: "",
              scope: defaultStudentLmsScope("google-classroom")
            }
          }
        : current
    );
  }, [
    packageDirty,
    packageDraft?.externalDeliveryMode,
    packageDraft?.id,
    packageDraft?.studentLmsBinding.connectionId,
    packageDraft?.studentLmsBinding.provider,
    snapshot
  ]);

  useEffect(() => {
    if (packageDraft?.externalDeliveryMode === "lockdown-only" && integrationSettingsTabs.has(settingsTab)) {
      setSettingsTab("overview");
    }
  }, [packageDraft?.externalDeliveryMode, settingsTab]);

  if (!settings || !security || !packageDraft || !destinationDraft || !connectionDraft || !snapshot) {
    return null;
  }

  const securityOverview = snapshot.securityOverview;
  const packageOptions = snapshot.configPackages;
  const selectedExam = snapshot.exams.find((exam) => exam.id === packageDraft.examId);
  const packageIsLockdownOnly = packageDraft.externalDeliveryMode === "lockdown-only";
  const visibleSettingsTabs = packageIsLockdownOnly
    ? settingsTabs.filter((tab) => !integrationSettingsTabs.has(tab.id))
    : settingsTabs;
  const bindingConnections = snapshot.lmsConnections.filter(
    (connection) => connection.provider === packageDraft.studentLmsBinding.provider && connection.status === "connected"
  );
  const updateSettings = (updater: (current: AppSettings) => AppSettings) => {
    setSettingsDirty(true);
    setSettings((current) => (current ? updater(current) : current));
  };
  const updateSecurity = (updater: (current: SecurityProfile) => SecurityProfile) => {
    setSecurityDirty(true);
    setSecurity((current) => (current ? updater(current) : current));
  };
  const updatePackage = (updater: (current: ExamConfigPackage) => ExamConfigPackage) => {
    setPackageDirty(true);
    setPackageDraft((current) => (current ? updater(current) : current));
  };
  const setPackageExternalDeliveryMode = (mode: ExamConfigPackage["externalDeliveryMode"]) => {
    updatePackage((current) =>
      mode === "lockdown-only"
        ? {
            ...current,
            externalDeliveryMode: mode,
            studentLmsBinding: lockdownOnlyStudentLmsBinding(current.studentLmsBinding.provider),
            resultDestinations: []
          }
        : {
            ...current,
            externalDeliveryMode: mode
          }
    );
  };
  const setPackageStartCode = async (value: string) => {
    const code = normalizeStartCode(value);
    if (!code) {
      updatePackage((current) => ({
        ...current,
        studentAccessPolicy: {
          ...current.studentAccessPolicy,
          startCodeHash: undefined,
          startCodeSalt: undefined
        }
      }));
      return;
    }

    const salt = createStartCodeSalt();
    const hash = await hashExamStartCode(code, salt);
    updatePackage((current) => ({
      ...current,
      studentAccessPolicy: {
        ...current.studentAccessPolicy,
        startCodeHash: hash,
        startCodeSalt: salt
      }
    }));
  };
  const updateDestination = (updater: (current: ResultDestination) => ResultDestination) => {
    setDestinationDirty(true);
    setDestinationDraft((current) => (current ? updater(current) : current));
  };
  const updateConnection = (updater: (current: LmsConnection) => LmsConnection) => {
    setConnectionDirty(true);
    setConnectionDraft((current) => (current ? updater(current) : current));
  };
  const adminBusy = pendingAction !== null;
  const isPending = (action: AdminActionState): boolean => pendingAction === action;
  const googleIntegrationReady =
    settings.googleIntegration.enabled && settings.googleIntegration.clientId.trim().length > 0;
  const connectionHasAdminSetup =
    connectionDraft.provider === "google-classroom" ? googleIntegrationReady : hasAdminLmsSetup(connectionDraft);
  // Video/demo note: these tabs turn the Admin Console from one long page into smaller teacher/admin pages.
  const settingsTabClass = (tab: SettingsTab): string => (settingsTab === tab ? "space-y-6" : "hidden");
  const settingsTabStyle = (tab: SettingsTab): CSSProperties =>
    settingsTab === tab ? {} : { display: "none" };
  const adminUnlockPin = settings.adminUnlockPin.trim();
  const adminUnlockRequiresPin = adminUnlockPin.length > 0;

  const unlockAdvancedAdminSections = () => {
    if (adminUnlockRequiresPin && adminPinAttempt.trim() !== adminUnlockPin) {
      setAdminUnlockError("Incorrect admin PIN.");
      return;
    }

    setAdminAdvancedUnlocked(true);
    setAdminUnlockError(null);
    setAdminPinAttempt("");
  };

  const lockAdvancedAdminSections = () => {
    setAdminAdvancedUnlocked(false);
    setAdminUnlockError(null);
    setAdminPinAttempt("");
  };

  const syncStructuredEditors = (nextPackage: ExamConfigPackage | null) => {
    setPackageDraft(nextPackage);
    setUrlRulesText(nextPackage ? serializeUrlRules(nextPackage.browserPolicy.urlRules) : "");
    setAllowedAppsText(nextPackage ? serializeAllowedApps(nextPackage) : "");
    setBindingStudents([]);
  };

  const selectPackage = (nextPackage: ExamConfigPackage | null) => {
    setSelectedPackageId(nextPackage?.id ?? "");
    syncStructuredEditors(nextPackage);
    setPackageDirty(false);
  };

  const selectDestination = (nextDestination: ResultDestination | null) => {
    setSelectedDestinationId(nextDestination?.id ?? "");
    setDestinationDraft(nextDestination ?? blankResultDestinationWithDefaults(settings));
    setDestinationDirty(false);
  };

  const selectConnection = (nextConnection: LmsConnection | null) => {
    setSelectedConnectionId(nextConnection?.id ?? "");
    setConnectionDraft(nextConnection ?? blankLmsConnection());
    setConnectionDirty(false);
    setConnectionCourses([]);
    setBindingStudents([]);
  };

  const buildPackageDraft = (): ExamConfigPackage => {
    const studentLmsBinding =
      packageDraft.externalDeliveryMode === "lockdown-only"
        ? lockdownOnlyStudentLmsBinding(packageDraft.studentLmsBinding.provider)
        : {
            ...packageDraft.studentLmsBinding,
            connectionId: packageDraft.studentLmsBinding.connectionId?.trim() || undefined,
            clientId: packageDraft.studentLmsBinding.clientId.trim(),
            clientSecret: packageDraft.studentLmsBinding.clientSecret?.trim() || undefined,
            tenantId: packageDraft.studentLmsBinding.provider === "microsoft-365"
              ? packageDraft.studentLmsBinding.tenantId?.trim() || "common"
              : undefined,
            scope: defaultStudentLmsScope(packageDraft.studentLmsBinding.provider),
            courseId: packageDraft.studentLmsBinding.courseId.trim(),
            courseLabel: packageDraft.studentLmsBinding.courseLabel?.trim() || undefined,
            assignmentId: packageDraft.studentLmsBinding.assignmentId.trim(),
            assignmentLabel: packageDraft.studentLmsBinding.assignmentLabel?.trim() || undefined
          };

    return {
      ...packageDraft,
      passwordHint: undefined,
      browserPolicy: {
        ...packageDraft.browserPolicy,
        urlRules: parseUrlRules(urlRulesText)
      },
      allowedApplications: parseAllowedApps(allowedAppsText),
      studentAccessPolicy: {
        ...packageDraft.studentAccessPolicy,
        assignedClassNames: packageDraft.studentAccessPolicy.assignedClassNames.map((entry) => entry.trim()).filter(Boolean),
        assignedCandidateIds: packageDraft.studentAccessPolicy.assignedCandidateIds.map((entry) => entry.trim()).filter(Boolean),
        availableFrom: packageDraft.studentAccessPolicy.availableFrom?.trim() || undefined,
        availableUntil: packageDraft.studentAccessPolicy.availableUntil?.trim() || undefined,
        startCodeHash: packageDraft.studentAccessPolicy.startCodeHash?.trim() || undefined,
        startCodeSalt: packageDraft.studentAccessPolicy.startCodeSalt?.trim() || undefined,
        startCodeHint: packageDraft.studentAccessPolicy.startCodeHint?.trim() || undefined
      },
      studentLmsBinding,
      resultDestinations: packageDraft.externalDeliveryMode === "lockdown-only" ? [] : packageDraft.resultDestinations
    };
  };

  const runAdminAction = async <T,>(
    action: AdminActionState,
    operation: () => Promise<T | null>,
    options: {
      success: string | ((result: T) => string);
      empty: string;
      onSuccess?: (result: T) => void;
    }
  ) => {
    setPendingAction(action);
    setActionFeedback({
      tone: "info",
      text:
        action === "refresh-diagnostics"
          ? "Refreshing diagnostics..."
          : action === "save-posture"
            ? "Saving security posture..."
            : action === "save-package"
              ? "Saving package..."
              : action === "save-settings"
                ? "Saving application settings..."
                : action === "save-destination"
                  ? "Saving result destination..."
                  : action === "delete-destination"
                    ? "Deleting result destination..."
                    : action === "save-lms-connection"
                      ? "Saving LMS connection..."
                      : action === "delete-lms-connection"
                        ? "Deleting LMS connection..."
                    : action === "connect-lms"
                      ? "Connecting LMS account..."
                      : action === "sign-out-lms"
                        ? "Signing out..."
                        : action === "clear-lms-tokens"
                          ? "Clearing stored tokens..."
                          : action === "load-lms-courses"
                            ? "Loading classes..."
                            : action === "load-lms-coursework"
                              ? "Loading assignments..."
                : action === "load-lms-students"
                  ? "Loading students..."
                  : action === "publish-classroom-package"
                    ? "Posting package to Google Classroom..."
                : action === "duplicate-package"
                  ? "Duplicating package..."
                  : action === "delete-package"
                    ? "Deleting package..."
                    : action === "export-package"
                      ? "Exporting package..."
                      : "Importing package..."
    });

    try {
      const result = await operation();
      if (result === null) {
        setActionFeedback({ tone: "error", text: options.empty });
        return;
      }

      options.onSuccess?.(result);
      setActionFeedback({
        tone: "success",
        text: typeof options.success === "function" ? options.success(result) : options.success
      });
    } catch (error) {
      setActionFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Unexpected error."
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleRefreshDiagnostics = async () =>
    runAdminAction("refresh-diagnostics", refreshSecurityOverview, {
      success: "Diagnostics refreshed.",
      empty: "Diagnostics refresh did not complete."
    });

  const handleSaveSecurityPosture = async () =>
    runAdminAction("save-posture", () => saveSecurityProfile(security), {
      success: "Security posture saved.",
      empty: "Security posture was not saved.",
      onSuccess: () => setSecurityDirty(false)
    });

  const handleSavePackage = async () => {
    const nextPackage = buildPackageDraft();
    await runAdminAction("save-package", () => saveConfigPackage(nextPackage), {
      success: `Saved package "${nextPackage.label}".`,
      empty: "Package changes were not saved.",
      onSuccess: () => setPackageDirty(false)
    });
  };

  const handleSaveSettings = async () => {
    const nextSettings: AppSettings = {
      ...settings,
      adminUnlockPin: settings.adminUnlockPin.trim(),
      invigilatorUnlockPin: settings.invigilatorUnlockPin.trim(),
      defaultGoogleSheetsSyncEndpoint: settings.defaultGoogleSheetsSyncEndpoint?.trim() ?? "",
      googleIntegration: {
        ...settings.googleIntegration,
        clientId: settings.googleIntegration.clientId.trim(),
        clientSecret: settings.googleIntegration.clientSecret?.trim() ?? "",
        requestedScopes:
          settings.googleIntegration.requestedScopes.length > 0
            ? mergeGoogleDefaultScopes(settings.googleIntegration.requestedScopes)
            : defaultLmsScope("google-classroom").split(/\s+/),
        connectionStatus: settings.googleIntegration.enabled
          ? settings.googleIntegration.connectionStatus
          : "disconnected",
        lastError: settings.googleIntegration.enabled ? settings.googleIntegration.lastError : undefined
      }
    };

    return runAdminAction("save-settings", () => saveSettings(nextSettings), {
      success: "Application settings saved.",
      empty: "Application settings were not saved.",
      onSuccess: () => {
        setSettings(nextSettings);
        setSettingsDirty(false);
      }
    });
  };

  const handleSaveDestination = async () => {
    const nextDestination = {
      ...destinationDraft,
      label: destinationDraft.label.trim() || providerLabel(destinationDraft.type),
      endpointUrl: destinationDraft.endpointUrl.trim(),
      className: destinationDraft.className?.trim() || undefined,
      courseId: destinationDraft.courseId?.trim() || undefined,
      assignmentId: destinationDraft.assignmentId?.trim() || undefined,
      assignmentLabel: destinationDraft.assignmentLabel?.trim() || undefined,
      connectionId: destinationDraft.connectionId?.trim() || undefined,
      bridgeEndpointUrl: destinationDraft.bridgeEndpointUrl?.trim() || undefined,
      sortByLastName: destinationDraft.sortByLastName === true,
      sheetName: destinationDraft.sheetName?.trim() || undefined,
      authToken: destinationDraft.authToken?.trim() || undefined,
      apiKeyHeader: destinationDraft.apiKeyHeader?.trim() || undefined,
      notes: destinationDraft.notes?.trim() || undefined
    };

    await runAdminAction("save-destination", () => saveResultDestination(nextDestination), {
      success: `Saved result destination "${nextDestination.label}".`,
      empty: "Result destination was not saved.",
      onSuccess: (nextSnapshot) => {
        const saved =
          nextSnapshot.resultDestinations.find((candidate) => candidate.id === nextDestination.id) ??
          nextSnapshot.resultDestinations[0] ??
          nextDestination;
        selectDestination(saved);
      }
    });
  };

  const handleDeleteDestination = async () =>
    runAdminAction("delete-destination", () => deleteResultDestination(destinationDraft.id), {
      success: "Result destination deleted.",
      empty: "Result destination deletion did not complete.",
      onSuccess: (nextSnapshot) => {
        selectDestination(nextSnapshot.resultDestinations[0] ?? blankResultDestinationWithDefaults(settings));
      }
    });

  const handleSaveConnection = async () => {
    const googleScopes = settings.googleIntegration.requestedScopes.length > 0
      ? settings.googleIntegration.requestedScopes.join(" ")
      : defaultLmsScope("google-classroom");
    const nextConnection = {
      ...connectionDraft,
      label: connectionDraft.label.trim() || providerLabel(connectionDraft.provider),
      clientId:
        connectionDraft.provider === "google-classroom"
          ? settings.googleIntegration.clientId.trim()
          : connectionDraft.clientId.trim(),
      clientSecret:
        connectionDraft.provider === "google-classroom"
          ? settings.googleIntegration.clientSecret?.trim() || undefined
          : connectionDraft.clientSecret?.trim() || undefined,
      tenantId: connectionDraft.tenantId?.trim() || undefined,
      authorizeUrl: connectionDraft.authorizeUrl?.trim() || undefined,
      tokenUrl: connectionDraft.tokenUrl?.trim() || undefined,
      scope:
        connectionDraft.provider === "google-classroom"
          ? googleScopes
          : connectionDraft.scope.trim() || defaultLmsScope(connectionDraft.provider)
    };

    await runAdminAction("save-lms-connection", () => saveLmsConnection(nextConnection), {
      success: `Saved LMS connection "${nextConnection.label}".`,
      empty: "LMS connection was not saved.",
      onSuccess: (nextSnapshot) => {
        const saved =
          nextSnapshot.lmsConnections.find((candidate) => candidate.id === nextConnection.id) ??
          nextSnapshot.lmsConnections[0] ??
          nextConnection;
        selectConnection(saved);
      }
    });
  };

  const handleDeleteConnection = async () =>
    runAdminAction("delete-lms-connection", () => deleteLmsConnection(connectionDraft.id), {
      success: "LMS connection deleted.",
      empty: "LMS connection deletion did not complete.",
      onSuccess: (nextSnapshot) => {
        selectConnection(nextSnapshot.lmsConnections[0] ?? blankLmsConnection());
      }
    });

  const handleConnectLms = async () => {
    setPendingAction("connect-lms");
    setActionFeedback({
      tone: "info",
      text:
        connectionDraft.provider === "google-classroom"
          ? "Connecting Google Classroom..."
          : "Connecting LMS account..."
    });

    try {
      const nextSnapshot = await connectLmsConnection(connectionDraft.id);
      if (!nextSnapshot) {
        setActionFeedback({ tone: "error", text: "LMS connection did not complete." });
        return;
      }

      const connected =
        nextSnapshot.lmsConnections.find((candidate) => candidate.id === connectionDraft.id) ??
        nextSnapshot.lmsConnections[0];
      if (!connected) {
        setActionFeedback({ tone: "error", text: "Connected account was not found." });
        return;
      }

      selectConnection(connected);

      if (connected.provider !== "google-classroom") {
        setActionFeedback({ tone: "success", text: "LMS account connected." });
        return;
      }

      setActionFeedback({ tone: "info", text: "Connected. Loading Google Classroom classes..." });
      const courses = await listLmsCourses(connected.id);
      setConnectionCourses(courses);
      setActionFeedback({
        tone: "success",
        text: `Connected Google Classroom and loaded ${courses.length} class${courses.length === 1 ? "" : "es"}.`
      });
    } catch (error) {
      setConnectionCourses([]);
      setActionFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "Google Classroom could not connect. Reconnect Google Classroom and try again."
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleSignOutLms = async () =>
    runAdminAction(
      "sign-out-lms",
      () => signOutLmsConnection({ connectionId: connectionDraft.id, revoke: true }),
      {
        success: "Signed out and revoked the stored Google authorization.",
        empty: "Sign-out did not complete.",
        onSuccess: (nextSnapshot) => {
          const signedOut =
            nextSnapshot.lmsConnections.find((candidate) => candidate.id === connectionDraft.id) ??
            nextSnapshot.lmsConnections[0];
          if (signedOut) {
            selectConnection(signedOut);
          }
        }
      }
    );

  const handleClearLmsTokens = async () =>
    runAdminAction("clear-lms-tokens", () => clearLmsConnectionTokens(connectionDraft.id), {
      success: "Stored OAuth tokens cleared from this device.",
      empty: "Token reset did not complete.",
      onSuccess: (nextSnapshot) => {
        const reset =
          nextSnapshot.lmsConnections.find((candidate) => candidate.id === connectionDraft.id) ??
          nextSnapshot.lmsConnections[0];
        if (reset) {
          selectConnection(reset);
        }
      }
    });

  const handleLoadCourses = async (connectionId: string = connectionDraft.id) => {
    const targetConnectionId = connectionId.trim();
    if (!targetConnectionId) {
      setActionFeedback({ tone: "error", text: "Choose a connected Google Classroom account before loading classes." });
      return;
    }

    setPendingAction("load-lms-courses");
    setActionFeedback({ tone: "info", text: "Loading Google Classroom classes..." });
    try {
      const courses = await listLmsCourses(targetConnectionId);
      setConnectionCourses(courses);
      setActionFeedback({
        tone: courses.length > 0 ? "success" : "info",
        text:
          courses.length > 0
            ? `Loaded ${courses.length} class${courses.length === 1 ? "" : "es"}.`
            : "No classes were returned for this Google Classroom account."
      });
    } catch (error) {
      setConnectionCourses([]);
      setActionFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "Google Classroom classes could not be loaded. Try reconnecting Google Classroom."
      });
    } finally {
      setPendingAction(null);
    }
  };

  const selectBindingCourse = (course: LmsCourse) => {
    setBindingCourseWork([]);
    setBindingStudents([]);
    updatePackage((current) => ({
      ...current,
      studentLmsBinding: {
        ...current.studentLmsBinding,
        courseId: course.id,
        courseLabel: course.name,
        assignmentId: "",
        assignmentLabel: ""
      },
      studentAccessPolicy: {
        ...current.studentAccessPolicy,
        assignedClassNames: course.name ? [course.name] : current.studentAccessPolicy.assignedClassNames,
        assignedCandidateIds: []
      }
    }));

    const connectionId = packageDraft.studentLmsBinding.connectionId?.trim();
    if (connectionId) {
      void loadBindingCourseWork(connectionId, course.id);
    }
  };

  const removeLoadedCourse = (courseId: string) => {
    setConnectionCourses((courses) => courses.filter((course) => course.id !== courseId));
    if (packageDraft.studentLmsBinding.courseId !== courseId) {
      return;
    }

    setBindingCourseWork([]);
    setBindingStudents([]);
    updatePackage((current) => ({
      ...current,
      studentLmsBinding: {
        ...current.studentLmsBinding,
        courseId: "",
        courseLabel: "",
        assignmentId: "",
        assignmentLabel: ""
      },
      studentAccessPolicy: {
        ...current.studentAccessPolicy,
        assignedClassNames: [],
        assignedCandidateIds: []
      }
    }));
  };

  const loadBindingCourseWork = async (connectionId: string, courseId: string) => {
    if (!connectionId || !courseId.trim()) {
      setActionFeedback({
        tone: "error",
        text: "Choose a connected LMS account and class before loading assignments."
      });
      return;
    }

    await runAdminAction(
      "load-lms-coursework",
      () =>
        listLmsCourseWork({
          connectionId,
          courseId
        }),
      {
        success: (items) => `Loaded ${items.length} assignment${items.length === 1 ? "" : "s"}.`,
        empty: "No assignments were returned for this class.",
        onSuccess: (items) => setBindingCourseWork(items)
      }
    );
  };

  const studentAccessId = (student: LmsStudent): string => student.email?.trim() || student.id;
  const selectedStudentIds = new Set(
    packageDraft.studentAccessPolicy.assignedCandidateIds.length === 0 && packageDraft.studentAccessPolicy.assignedClassNames.length > 0
      ? bindingStudents.map(studentAccessId)
      : packageDraft.studentAccessPolicy.assignedCandidateIds
  );

  const applyStudentSelection = (students: LmsStudent[], selectedIds: Set<string>) => {
    const allSelected = students.length > 0 && selectedIds.size === students.length;
    const className = packageDraft.studentLmsBinding.courseLabel || selectedExam?.className || packageDraft.studentLmsBinding.courseId;
    updatePackage((current) => ({
      ...current,
      studentAccessPolicy: {
        ...current.studentAccessPolicy,
        assignedClassNames: allSelected && className ? [className] : [],
        assignedCandidateIds: allSelected ? [] : Array.from(selectedIds)
      }
    }));
  };

  const handleLoadBindingStudents = async () => {
    const binding = packageDraft.studentLmsBinding;
    const connectionId = binding.connectionId?.trim();
    if (!connectionId || !binding.courseId.trim()) {
      setActionFeedback({
        tone: "error",
        text: "Choose a connected LMS account and class before loading students."
      });
      return;
    }

    await runAdminAction(
      "load-lms-students",
      () =>
        listLmsStudents({
          connectionId,
          courseId: binding.courseId
        }),
      {
        success: (students) => `Loaded ${students.length} student${students.length === 1 ? "" : "s"}.`,
        empty: "No students were returned for this class.",
        onSuccess: (students) => {
          setBindingStudents(students);
          applyStudentSelection(students, new Set(students.map(studentAccessId)));
        }
      }
    );
  };

  const handleLoadBindingCourseWork = async () => {
    const binding = packageDraft.studentLmsBinding;
    await loadBindingCourseWork(binding.connectionId?.trim() ?? "", binding.courseId);
  };

  const selectBindingAssignment = (assignment: LmsCourseWork) => {
    updatePackage((current) => ({
      ...current,
      studentLmsBinding: {
        ...current.studentLmsBinding,
        assignmentId: assignment.id,
        assignmentLabel: assignment.title
      }
    }));
  };

  const applyClassroomBindingToGradeSync = () => {
    const binding = packageDraft.studentLmsBinding;
    if (packageDraft.externalDeliveryMode === "lockdown-only") {
      setActionFeedback({
        tone: "error",
        text: "Switch package use to LMS / grade integrations before adding Classroom grade sync."
      });
      return;
    }

    if (!binding.connectionId || !binding.courseId) {
      setActionFeedback({
        tone: "error",
        text: "Choose a connected Google Classroom account and class before setting up grade sync."
      });
      return;
    }

    const teacherConnection = snapshot.lmsConnections.find((connection) => connection.id === binding.connectionId);
    const courseLabel = binding.courseLabel || binding.courseId;
    const examIds = selectedExam?.id ? Array.from(new Set([...(destinationDraft.examIds ?? []), selectedExam.id])) : destinationDraft.examIds;
    const notes = [
      `Google Classroom account: ${teacherConnection ? lmsAccountOptionLabel(teacherConnection) : binding.connectionId}`,
      `Class: ${courseLabel}`,
      `Course ID: ${binding.courseId}`,
      binding.assignmentId ? `Assignment: ${binding.assignmentLabel || binding.assignmentId}` : "",
      binding.assignmentId ? `Assignment ID: ${binding.assignmentId}` : "",
      "Server-side grade sync writes scores through the school-owned bridge after local submission."
    ]
      .filter(Boolean)
      .join("\n");

    setSelectedDestinationId(destinationDraft.id);
    setDestinationDirty(true);
    setDestinationDraft((current) =>
      current
        ? {
            ...current,
            type: "google-classroom-grade-sync",
            label:
              current.label === "New destination" || current.label === providerLabel(current.type)
                ? `Classroom grade sync - ${courseLabel}`
                : current.label,
            enabled: true,
            trigger: "auto-on-submit",
            className: courseLabel,
            courseId: binding.courseId,
            assignmentId: binding.assignmentId || undefined,
            assignmentLabel: binding.assignmentLabel || undefined,
            connectionId: binding.connectionId,
            examIds,
            includeResponses: true,
            notes
          }
        : current
    );
    setSettingsTab("results");
    setActionFeedback({
      tone: "success",
      text: "Classroom class and assignment details were copied into Grade sync. Add the grade-sync server endpoint, then save the destination."
    });
  };

  const handleDuplicatePackage = async () => {
    const previousIds = new Set(snapshot.configPackages.map((candidate) => candidate.id));
    await runAdminAction("duplicate-package", () => duplicateConfigPackage(packageDraft.id), {
      success: "Configuration package duplicated.",
      empty: "Package duplication did not complete.",
      onSuccess: (nextSnapshot) => {
        const duplicated =
          nextSnapshot.configPackages.find((candidate) => !previousIds.has(candidate.id)) ?? nextSnapshot.configPackages[0];
        if (duplicated) {
          selectPackage(duplicated);
        }
      }
    });
  };

  const handleDeletePackage = async () =>
    runAdminAction("delete-package", () => deleteConfigPackage(packageDraft.id), {
      success: "Configuration package deleted.",
      empty: "Package deletion did not complete.",
      onSuccess: () => setPackageDirty(false)
    });

  const handleExportPackage = async () => {
    const nextPackage = packageDirty ? buildPackageDraft() : null;
    const exportCandidate = nextPackage ?? packageDraft;
    if (
      exportCandidate.externalDeliveryMode === "integrated" &&
      exportCandidate.studentLmsBinding.enabled &&
      !exportCandidate.studentLmsBinding.assignmentId.trim()
    ) {
      setActionFeedback({
        tone: "error",
        text:
          "Choose an existing LMS assignment or post the package to the class before exporting with student LMS turn-in enabled. If the assignment will be created later, disable student LMS turn-in and use a server-side grade-sync mapping, then re-save/re-export after the assignment exists."
      });
      return;
    }

    await runAdminAction(
      "export-package",
      async () => {
        if (nextPackage) {
          const saved = await saveConfigPackage(nextPackage);
          if (!saved) {
            return null;
          }
        }

        return exportConfigPackage({
          packageId: packageDraft.id
        });
      },
      {
        success: (filePath) => `Package exported to ${filePath}`,
        empty: "Package export was cancelled or did not complete.",
        onSuccess: () => setPackageDirty(false)
      }
    );
  };

  const handlePublishPackageToClassroom = async () => {
    if (packageDraft.externalDeliveryMode === "lockdown-only") {
      setActionFeedback({
        tone: "error",
        text: "Switch package use to LMS / grade integrations before posting to Google Classroom."
      });
      return;
    }

    if (packageDirty) {
      await handleSavePackage();
    }

    await runAdminAction(
      "publish-classroom-package",
      () => publishConfigPackageToClassroom({ packageId: packageDraft.id }),
      {
        success: (published) =>
          `Posted "${published.courseWork.title}" to Google Classroom${published.driveFileName ? ` with ${published.driveFileName}` : ""}.`,
        empty: "Google Classroom post did not complete.",
        onSuccess: (published) => {
          setPackageDraft((current) => current ? ({
            ...current,
            studentLmsBinding: {
              ...current.studentLmsBinding,
              assignmentId: published.courseWork.id,
              assignmentLabel: published.courseWork.title
            }
          }) : current);
          setPackageDirty(false);
        }
      }
    );
  };

  const handleImportPackage = async () => {
    const previousPackages = new Map(
      snapshot.configPackages.map((candidate) => [candidate.id, `${candidate.updatedAt}|${candidate.integrity.checksum}`])
    );
    await runAdminAction(
      "import-package",
      () => importConfigPackage(),
      {
        success: "Configuration package imported.",
        empty: "Package import was cancelled or did not complete.",
        onSuccess: (nextSnapshot) => {
          const imported = findImportedPackage(previousPackages, nextSnapshot.configPackages);
          if (imported) {
            selectPackage(imported);
          }
        }
      }
    );
  };

  return (
    <motion.div key="settings" {...animation} className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Admin Console</h1>
          <p className="mt-2 text-sm text-slate-800 dark:text-slate-100">
            Manage the Lockedscreen kiosk component, exam runtime packages, diagnostics, and Windows deployment posture from one workflow.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void handleRefreshDiagnostics()} disabled={adminBusy}>
            <ShieldCheck className="size-4" />
            {isPending("refresh-diagnostics") ? "Refreshing..." : "Refresh diagnostics"}
          </Button>
          <Button variant="secondary" onClick={() => void handleSaveSecurityPosture()} disabled={adminBusy}>
            <ShieldCheck className="size-4" />
            {isPending("save-posture") ? "Saving..." : "Save posture"}
          </Button>
          <Button variant="secondary" onClick={() => void handleSavePackage()} disabled={adminBusy}>
            <Save className="size-4" />
            {isPending("save-package") ? "Saving..." : "Save package"}
          </Button>
          <Button onClick={() => void handleSaveSettings()} disabled={adminBusy}>
            <Save className="size-4" />
            {isPending("save-settings") ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </div>

      {actionFeedback ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${feedbackTone(actionFeedback.tone)}`}>{actionFeedback.text}</div>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        {visibleSettingsTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              settingsTab === tab.id
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
            }`}
            onClick={() => setSettingsTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={settingsTabClass("overview")} style={settingsTabStyle("overview")}>
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Configuration packages</CardTitle>
              <CardDescription className="mt-2">
                Exam packages carry the exam and runtime policy for student devices. Students can open exported `.lscp` files directly from File Explorer.
              </CardDescription>
            </div>
            <Badge className="bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100">{snapshot.configPackages.length} package(s)</Badge>
          </div>
          <LabelledField label="Active package">
            <select
              className={selectClassName}
              value={selectedPackageId}
              onChange={(event) => {
                const selected = packageOptions.find((candidate) => candidate.id === event.target.value);
                selectPackage(selected ?? null);
              }}
            >
              {packageOptions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </LabelledField>
          <div className="grid gap-3 md:grid-cols-4">
            <Button variant="secondary" onClick={() => void handleDuplicatePackage()} disabled={adminBusy}>
              {isPending("duplicate-package") ? "Duplicating..." : "Duplicate"}
            </Button>
            <Button variant="secondary" onClick={() => void handleDeletePackage()} disabled={adminBusy}>
              {isPending("delete-package") ? "Deleting..." : "Delete"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleExportPackage()}
              disabled={adminBusy}
            >
              {isPending("export-package") ? "Exporting..." : "Export"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleImportPackage()}
              disabled={adminBusy}
            >
              {isPending("import-package") ? "Importing..." : "Import"}
            </Button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Package use</div>
                <div className="mt-1 text-slate-800 dark:text-slate-100">
                  {packageIsLockdownOnly
                    ? "Exports omit Google Classroom, LMS turn-in, grade sync, and Google Sheets targets."
                    : "Exports can include configured LMS turn-in and grade-sync destinations."}
                </div>
              </div>
              <Badge className={packageIsLockdownOnly ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950" : "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-100"}>
                {packageIsLockdownOnly ? "Lockdown-only" : "Integrations enabled"}
              </Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  packageIsLockdownOnly
                    ? "border-slate-900 bg-white text-slate-950 shadow-sm dark:border-slate-100 dark:bg-slate-950 dark:text-slate-50"
                    : "border-slate-200 bg-white text-slate-800 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                }`}
                onClick={() => setPackageExternalDeliveryMode("lockdown-only")}
              >
                <span className="block font-semibold">Lockdown-only exam app</span>
                <span className="mt-1 block text-xs">No Google Classroom, grade sync, LMS, or sheet setup required.</span>
              </button>
              <button
                type="button"
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  !packageIsLockdownOnly
                    ? "border-teal-500 bg-teal-50 text-teal-950 shadow-sm dark:border-teal-400 dark:bg-teal-950 dark:text-teal-50"
                    : "border-slate-200 bg-white text-slate-800 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                }`}
                onClick={() => setPackageExternalDeliveryMode("integrated")}
              >
                <span className="block font-semibold">LMS / grade integrations</span>
                <span className="mt-1 block text-xs">Use Classroom, Microsoft 365, Sheets, or sync endpoints after submission.</span>
              </button>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            Exported package files do not require a PIN or password. Double-clicking a package on a student install imports it and opens the exam environment.
          </div>
        </Card>

        <Card className="space-y-5">
          <CardTitle>Integrity summary</CardTitle>
          <CardDescription>
            The kiosk component validates package checksums locally. Stronger Windows lock still depends on a verified native Windows companion or official kiosk deployment.
          </CardDescription>
          <div className="grid gap-3">
            {securityOverview?.validationItems.map((item) => (
              <ValidationCard key={item.id} item={item} />
            ))}
          </div>
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("google")} style={settingsTabStyle("google")}> 
      <Card className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Google Classroom integration</CardTitle>
            <CardDescription className="mt-2">
              Teachers sign in with their school Google account after an admin completes the one-time school setup.
            </CardDescription>
          </div>
          <Badge>{settings.googleIntegration.enabled ? "Enabled" : "Disabled"}</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ToggleField
            label="Enable Google Classroom"
            checked={settings.googleIntegration.enabled}
            onChange={(checked) =>
              updateSettings((current) => ({
                ...current,
                googleIntegration: {
                  ...current.googleIntegration,
                  enabled: checked,
                  connectionStatus: checked ? current.googleIntegration.connectionStatus : "disconnected"
                }
              }))
            }
          />
          <div className={`rounded-2xl border px-4 py-3 text-sm ${feedbackTone(settings.googleIntegration.connectionStatus === "connected" ? "success" : settings.googleIntegration.connectionStatus === "error" ? "error" : "info")}`}>
            {settings.googleIntegration.connectionStatus === "connected"
              ? `Connected as ${settings.googleIntegration.accountName || settings.googleIntegration.accountEmail || "Google Classroom"}.`
              : settings.googleIntegration.connectionStatus === "error"
                ? settings.googleIntegration.lastError || "Google Classroom connection failed."
                : settings.googleIntegration.enabled
                  ? "Google Classroom is ready for teacher sign-in. Connect a teacher account below."
                  : "School setup is required before teachers can connect Google Classroom."}
          </div>
        </div>

        <AdvancedAdminSection
          title="Advanced admin Google setup"
          unlocked={adminAdvancedUnlocked}
          requiresPin={adminUnlockRequiresPin}
          pinAttempt={adminPinAttempt}
          unlockError={adminUnlockError}
          onPinAttemptChange={(value) => {
            setAdminPinAttempt(value);
            setAdminUnlockError(null);
          }}
          onUnlock={unlockAdvancedAdminSections}
          onLock={lockAdvancedAdminSections}
        >
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            These values are for the school administrator. Teachers do not need to know OAuth client IDs or permission scopes.
          </div>

          <div className="mt-4 grid gap-4">
            <LabelledField label="Google desktop app client ID">
              <Input
                value={settings.googleIntegration.clientId}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    googleIntegration: {
                      ...current.googleIntegration,
                      clientId: event.target.value,
                      connectionStatus:
                        event.target.value.trim() === current.googleIntegration.clientId.trim()
                          ? current.googleIntegration.connectionStatus
                          : "disconnected"
                    }
                  }))
                }
              />
            </LabelledField>

            <LabelledField label="Google desktop app client secret">
              <Input
                type="password"
                autoComplete="off"
                value={settings.googleIntegration.clientSecret ?? ""}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    googleIntegration: {
                      ...current.googleIntegration,
                      clientSecret: event.target.value,
                      connectionStatus:
                        event.target.value.trim() === (current.googleIntegration.clientSecret ?? "").trim()
                          ? current.googleIntegration.connectionStatus
                          : "disconnected"
                    }
                  }))
                }
              />
            </LabelledField>

            <LabelledField label="Requested Google permissions">
              <Textarea
                className="min-h-[130px] font-mono text-xs"
                value={settings.googleIntegration.requestedScopes.join("\n")}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    googleIntegration: {
                      ...current.googleIntegration,
                      requestedScopes: splitScopes(event.target.value),
                      connectionStatus: "disconnected"
                    }
                  }))
                }
              />
            </LabelledField>

            <LabelledField label="Default Google Sheets sync URL">
              <Input
                placeholder="https://script.google.com/macros/s/.../exec"
                value={settings.defaultGoogleSheetsSyncEndpoint ?? ""}
                onChange={(event) =>
                  updateSettings((current) => ({
                    ...current,
                    defaultGoogleSheetsSyncEndpoint: event.target.value
                  }))
                }
              />
              <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                Admin configures this once. Teachers can then paste only the Google Sheet link when preparing a test; both values are exported inside the test package for students.
              </div>
            </LabelledField>

            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Google Sheets sync setup guide</div>
                  <div className="mt-1 text-teal-900 dark:text-teal-100">
                    Create one Google Apps Script web app, deploy it, then paste its `/exec` URL above. The script creates headings automatically and adds new exam columns for repeat tests.
                  </div>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-teal-900 dark:text-teal-100">
                    <li>Open Google Apps Script and create a new project.</li>
                    <li>Paste the Lockedscreen Sheets sync script from the admin guide.</li>
                    <li>Deploy as a Web app, execute as the school/admin account, then copy the Web app URL.</li>
                  </ol>
                </div>
                <Button variant="secondary" onClick={() => void window.lockedscreenApi.openGoogleAppsScript()}>
                  Open Google Apps Script
                </Button>
              </div>
            </div>
          </div>
        </AdvancedAdminSection>

        {settings.googleIntegration.lastConnectedAt ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            Last connected: {formatDateTime(settings.googleIntegration.lastConnectedAt) ?? settings.googleIntegration.lastConnectedAt}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>LMS connections</CardTitle>
              <CardDescription className="mt-2">
                Connect Google Classroom or Microsoft 365 with the teacher's normal school sign-in. Schools that do not use LMS can skip this section.
              </CardDescription>
            </div>
            <Badge>{snapshot.lmsConnections.length} connection(s)</Badge>
          </div>

          <AdvancedAdminSection
            title="Advanced connection management"
            unlocked={adminAdvancedUnlocked}
            requiresPin={adminUnlockRequiresPin}
            pinAttempt={adminPinAttempt}
            unlockError={adminUnlockError}
            onPinAttemptChange={(value) => {
              setAdminPinAttempt(value);
              setAdminUnlockError(null);
            }}
            onUnlock={unlockAdvancedAdminSections}
            onLock={lockAdvancedAdminSections}
          >
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              Admins can create or repair the saved school connection here. Teachers normally only use Connect Google Classroom.
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <LabelledField label="School connection">
                <select
                  className={selectClassName}
                  value={snapshot.lmsConnections.some((candidate) => candidate.id === selectedConnectionId) ? selectedConnectionId : "__new__"}
                  onChange={(event) => {
                    if (event.target.value === "__new__") {
                      selectConnection(blankLmsConnection());
                      return;
                    }

                    const selected = snapshot.lmsConnections.find((candidate) => candidate.id === event.target.value);
                    selectConnection(selected ?? null);
                  }}
                >
                  <option value="__new__">New school connection</option>
                  {snapshot.lmsConnections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.label}
                    </option>
                  ))}
                </select>
              </LabelledField>
              <div className="grid gap-3 md:grid-cols-2">
                <Button variant="secondary" onClick={() => void handleSaveConnection()} disabled={adminBusy}>
                  {isPending("save-lms-connection") ? "Saving..." : "Save connection"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleDeleteConnection()}
                  disabled={adminBusy || !snapshot.lmsConnections.some((candidate) => candidate.id === connectionDraft.id)}
                >
                  {isPending("delete-lms-connection") ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <LabelledField label="LMS">
                <select
                  className={selectClassName}
                  value={connectionDraft.provider}
                  onChange={(event) => {
                    const provider = event.target.value as LmsProviderType;
                    updateConnection((current) => ({
                      ...current,
                      provider,
                      label:
                        current.label === providerLabel(current.provider) || current.label.trim().length === 0
                          ? providerLabel(provider)
                          : current.label,
                      clientId: provider === "google-classroom" ? settings.googleIntegration.clientId : current.clientId,
                      clientSecret:
                        provider === "google-classroom"
                          ? settings.googleIntegration.clientSecret?.trim() || undefined
                          : current.clientSecret,
                      scope:
                        provider === "google-classroom"
                          ? settings.googleIntegration.requestedScopes.join(" ") || defaultLmsScope(provider)
                          : defaultLmsScope(provider),
                      tenantId: provider === "microsoft-365" ? current.tenantId || "common" : "",
                      authorizeUrl: provider === "generic-oauth-lms" ? current.authorizeUrl : "",
                      tokenUrl: provider === "generic-oauth-lms" ? current.tokenUrl : ""
                    }));
                  }}
                >
                  <option value="google-classroom">Google Classroom</option>
                  <option value="microsoft-365">Microsoft 365</option>
                  {connectionDraft.provider === "generic-oauth-lms" ? (
                    <option value="generic-oauth-lms">Generic OAuth LMS</option>
                  ) : null}
                </select>
              </LabelledField>
              <LabelledField label="Connection name">
                <Input
                  value={connectionDraft.label}
                  onChange={(event) => updateConnection((current) => ({ ...current, label: event.target.value }))}
                />
              </LabelledField>
            </div>
          </AdvancedAdminSection>

          {connectionDraft.provider === "google-classroom" ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Teachers only need to connect their school Google account. If the button is disabled, ask an admin to finish the Google Classroom setup above.
            </div>
          ) : (
            <AdvancedAdminSection
              title="Admin/developer app registration setup"
              unlocked={adminAdvancedUnlocked}
              requiresPin={adminUnlockRequiresPin}
              pinAttempt={adminPinAttempt}
              unlockError={adminUnlockError}
              onPinAttemptChange={(value) => {
                setAdminPinAttempt(value);
                setAdminUnlockError(null);
              }}
              onUnlock={unlockAdvancedAdminSections}
              onLock={lockAdvancedAdminSections}
            >
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                These values are configured once by the school admin or developer. Teachers should not enter their email,
                password, class code, or assignment link here.
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <LabelledField label="App registration client ID">
                  <Input
                    value={connectionDraft.clientId}
                    onChange={(event) => updateConnection((current) => ({ ...current, clientId: event.target.value }))}
                  />
                </LabelledField>
                {connectionDraft.provider === "microsoft-365" ? (
                <LabelledField label="Microsoft tenant">
                  <Input
                    value={connectionDraft.tenantId ?? ""}
                    onChange={(event) => updateConnection((current) => ({ ...current, tenantId: event.target.value }))}
                  />
                </LabelledField>
                ) : null}
                {connectionDraft.provider === "generic-oauth-lms" ? (
                <LabelledField label="Authorize URL">
                  <Input
                    value={connectionDraft.authorizeUrl ?? ""}
                    onChange={(event) => updateConnection((current) => ({ ...current, authorizeUrl: event.target.value }))}
                  />
                </LabelledField>
                ) : null}
                {connectionDraft.provider === "generic-oauth-lms" ? (
                <LabelledField label="Token URL">
                  <Input
                    value={connectionDraft.tokenUrl ?? ""}
                    onChange={(event) => updateConnection((current) => ({ ...current, tokenUrl: event.target.value }))}
                  />
                </LabelledField>
                ) : null}
              </div>
              <div className="mt-4">
                <LabelledField label="Approved permission scopes">
                  <Textarea
                    className="min-h-[110px] font-mono text-xs"
                    value={connectionDraft.scope}
                    onChange={(event) => updateConnection((current) => ({ ...current, scope: event.target.value }))}
                  />
                </LabelledField>
              </div>
            </AdvancedAdminSection>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => void handleConnectLms()}
              disabled={
                adminBusy ||
                !connectionHasAdminSetup ||
                !snapshot.lmsConnections.some((candidate) => candidate.id === connectionDraft.id)
              }
            >
              {isPending("connect-lms")
                ? "Connecting..."
                : connectionHasAdminSetup
                  ? lmsConnectActionLabel(connectionDraft)
                  : "Admin setup required"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleLoadCourses()}
              disabled={adminBusy || connectionDraft.status !== "connected" || !snapshot.lmsConnections.some((candidate) => candidate.id === connectionDraft.id)}
            >
              {isPending("load-lms-courses") ? "Loading..." : "Load classes"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleSignOutLms()}
              disabled={adminBusy || connectionDraft.status !== "connected" || !snapshot.lmsConnections.some((candidate) => candidate.id === connectionDraft.id)}
            >
              {isPending("sign-out-lms") ? "Signing out..." : "Sign out"}
            </Button>
          </div>

          <AdvancedAdminSection
            title="Advanced account support"
            unlocked={adminAdvancedUnlocked}
            requiresPin={adminUnlockRequiresPin}
            pinAttempt={adminPinAttempt}
            unlockError={adminUnlockError}
            onPinAttemptChange={(value) => {
              setAdminPinAttempt(value);
              setAdminUnlockError(null);
            }}
            onUnlock={unlockAdvancedAdminSections}
            onLock={lockAdvancedAdminSections}
          >
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              Use token reset only when reconnecting does not work or when support asks you to clear the local saved authorization.
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleClearLmsTokens()}
                disabled={adminBusy || !snapshot.lmsConnections.some((candidate) => candidate.id === connectionDraft.id)}
              >
                {isPending("clear-lms-tokens") ? "Clearing..." : "Reset stored tokens"}
              </Button>
            </div>
          </AdvancedAdminSection>
        </Card>

        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Classroom classes</CardTitle>
              <CardDescription className="mt-2">
                Verify the connected teacher account can read Google Classroom classes.
              </CardDescription>
            </div>
            <Button
              variant="secondary"
              onClick={() => void handleLoadCourses()}
              disabled={adminBusy || connectionDraft.status !== "connected" || !snapshot.lmsConnections.some((candidate) => candidate.id === connectionDraft.id)}
            >
              {isPending("load-lms-courses") ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
          <div className="grid gap-3">
            <div className={`rounded-2xl border px-4 py-3 text-sm ${feedbackTone(connectionDraft.status === "connected" ? "success" : connectionDraft.status === "error" ? "error" : "info")}`}>
              {connectionDraft.status === "connected"
                ? `Connected as ${connectionDraft.accountName || connectionDraft.accountEmail || connectionDraft.label}.`
                : connectionDraft.status === "error"
                  ? connectionDraft.lastError || "Connection failed."
                  : connectionHasAdminSetup
                    ? "Save the connection, then connect with the teacher's school account in the system browser."
                    : connectionDraft.provider === "google-classroom"
                      ? "School setup is required before teachers can connect Google Classroom."
                      : "Admin setup is optional. To use LMS turn-in, a school admin must first add the app registration in the admin/developer setup section."}
            </div>
            {connectionDraft.accountEmail ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                Account: {connectionDraft.accountName || "Connected user"} / {connectionDraft.accountEmail}
              </div>
            ) : null}
            {isPending("load-lms-courses") && connectionDraft.provider === "google-classroom" ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                Loading Google Classroom classes...
              </div>
            ) : connectionCourses.length > 0 ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Loaded Google Classroom classes</div>
                  <Badge>{connectionCourses.length} loaded</Badge>
                </div>
                {connectionCourses.map((course) => (
                  <div
                    key={course.id}
                    className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-slate-50">{course.name}</div>
                      <div className="mt-1 text-slate-800 dark:text-slate-100">{course.section || course.id}</div>
                    </div>
                    <Button variant="secondary" onClick={() => removeLoadedCourse(course.id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <CardDescription>
                {connectionDraft.status === "connected"
                  ? "No classes are loaded yet. Use Refresh to load the connected teacher's classes."
                  : "After connecting, Lockedscreen will load the teacher's Google Classroom classes here."}
              </CardDescription>
            )}
            {connectionDraft.provider === "google-classroom" && connectionDraft.status === "error" ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Reconnect Google Classroom if the sign-in expired or Google needs the teacher to approve Classroom access again.
                <div className="mt-3">
                  <Button variant="secondary" onClick={() => void handleConnectLms()} disabled={adminBusy || !connectionHasAdminSetup}>
                    Reconnect Google Classroom
                  </Button>
                </div>
              </div>
            ) : null}
            <AdvancedAdminSection
              title="Advanced connection details"
              unlocked={adminAdvancedUnlocked}
              requiresPin={adminUnlockRequiresPin}
              pinAttempt={adminPinAttempt}
              unlockError={adminUnlockError}
              onPinAttemptChange={(value) => {
                setAdminPinAttempt(value);
                setAdminUnlockError(null);
              }}
              onUnlock={unlockAdvancedAdminSections}
              onLock={lockAdvancedAdminSections}
            >
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                Teacher OAuth tokens are kept only on this device and are not packed into `.lscp` files sent to students.
              </div>
            </AdvancedAdminSection>
          </div>
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("turnin")} style={settingsTabStyle("turnin")}> 
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Student LMS turn-in</CardTitle>
              <CardDescription className="mt-2">
                Optional. Bind this package to a Google Classroom or Microsoft 365 assignment after the school connection is set up.
              </CardDescription>
            </div>
            <Badge>{packageDraft.studentLmsBinding.enabled ? "Enabled" : "Disabled"}</Badge>
          </div>

          <ToggleField
            label="Enable post-submit student LMS turn-in"
            checked={packageDraft.studentLmsBinding.enabled}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                externalDeliveryMode: checked ? "integrated" : current.externalDeliveryMode,
                studentLmsBinding: {
                  ...current.studentLmsBinding,
                  enabled: checked
                }
              }))
            }
          />
          {packageIsLockdownOnly ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              This package is set to lockdown-only use. Switch Package use in Overview to LMS / grade integrations before selecting Classroom classes or assignments.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField label="LMS">
              <select
                className={selectClassName}
                value={packageDraft.studentLmsBinding.provider}
                disabled={packageIsLockdownOnly}
                onChange={(event) => {
                  const provider = event.target.value as StudentLmsProviderType;
                  setBindingCourseWork([]);
                  setBindingStudents([]);
                  setConnectionCourses([]);
                  updatePackage((current) => ({
                    ...current,
                    studentLmsBinding: {
                      ...blankStudentLmsBinding(provider),
                      enabled: current.studentLmsBinding.enabled
                    }
                  }));
                }}
              >
                <option value="google-classroom">Google Classroom</option>
                <option value="microsoft-365">Microsoft 365</option>
              </select>
            </LabelledField>
            <LabelledField label="Connected Google Classroom account">
              <select
                className={selectClassName}
                value={packageDraft.studentLmsBinding.connectionId ?? ""}
                disabled={packageIsLockdownOnly}
                onChange={(event) => {
                  const selectedConnection = snapshot.lmsConnections.find((candidate) => candidate.id === event.target.value) ?? null;
                  setBindingCourseWork([]);
                  setBindingStudents([]);
                  if (selectedConnection) {
                    selectConnection(selectedConnection);
                  }
                  updatePackage((current) => ({
                    ...current,
                    studentLmsBinding: {
                      ...current.studentLmsBinding,
                      connectionId: selectedConnection?.id ?? "",
                      provider: selectedConnection?.provider === "microsoft-365" ? "microsoft-365" : "google-classroom",
                      clientId: selectedConnection?.clientId ?? current.studentLmsBinding.clientId,
                      clientSecret: selectedConnection?.clientSecret ?? current.studentLmsBinding.clientSecret,
                      tenantId:
                        selectedConnection?.provider === "microsoft-365"
                          ? (selectedConnection.tenantId ?? "common")
                          : "",
                      scope: defaultStudentLmsScope(
                        selectedConnection?.provider === "microsoft-365" ? "microsoft-365" : "google-classroom"
                      )
                    }
                  }));
                }}
              >
                <option value="">Choose the teacher's connected Google account</option>
                {bindingConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {lmsAccountOptionLabel(connection)}
                  </option>
                ))}
              </select>
              {bindingConnections.length === 0 ? (
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-200">
                  Connect Google Classroom in the Google Classroom tab first. The teacher's signed-in name will appear here after
                  authorization succeeds.
                </div>
              ) : packageDraft.studentLmsBinding.connectionId ? (
                <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                  Student submissions will use {lmsAccountDisplayName(
                    bindingConnections.find((connection) => connection.id === packageDraft.studentLmsBinding.connectionId) ??
                      bindingConnections[0]!
                  )} for this Classroom link.
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                  Choose the teacher's signed-in Google account for this package.
                </div>
              )}
            </LabelledField>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <LabelledField label="Class / course">
              <select
                className={selectClassName}
                value={packageDraft.studentLmsBinding.courseId}
                disabled={packageIsLockdownOnly}
                onChange={(event) => {
                  const courseId = event.target.value;
                  const selectedCourse = connectionCourses.find((course) => course.id === event.target.value);
                  setBindingCourseWork([]);
                  setBindingStudents([]);
                  updatePackage((current) => ({
                    ...current,
                    studentLmsBinding: {
                      ...current.studentLmsBinding,
                      courseId,
                      courseLabel: selectedCourse?.name ?? current.studentLmsBinding.courseLabel,
                      assignmentId: "",
                      assignmentLabel: ""
                    },
                    studentAccessPolicy: {
                      ...current.studentAccessPolicy,
                      assignedClassNames: selectedCourse?.name ? [selectedCourse.name] : current.studentAccessPolicy.assignedClassNames,
                      assignedCandidateIds: []
                    }
                  }));
                  if (packageDraft.studentLmsBinding.connectionId && courseId) {
                    void loadBindingCourseWork(packageDraft.studentLmsBinding.connectionId, courseId);
                  }
                }}
              >
                <option value="">Load classes from the connected account</option>
                {connectionCourses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </LabelledField>
            <Button
              variant="secondary"
              onClick={() => void handleLoadCourses(packageDraft.studentLmsBinding.connectionId ?? "")}
              disabled={
                adminBusy ||
                packageIsLockdownOnly ||
                !packageDraft.studentLmsBinding.connectionId ||
                !snapshot.lmsConnections.some((candidate) => candidate.id === packageDraft.studentLmsBinding.connectionId)
              }
            >
              {isPending("load-lms-courses") ? "Loading..." : "Load classes"}
            </Button>
          </div>

          {connectionCourses.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Loaded Google Classroom classes</div>
                  <div className="text-xs text-slate-800 dark:text-slate-100">
                    Choose the class for this test. Remove only hides a class from this Lockedscreen list; it does not delete it from Google Classroom.
                  </div>
                </div>
                <Badge>{connectionCourses.length} loaded</Badge>
              </div>
              <div className="grid gap-2">
                {connectionCourses.map((course) => {
                  const selected = packageDraft.studentLmsBinding.courseId === course.id;
                  return (
                    <div
                      key={course.id}
                      className={`grid gap-3 rounded-xl border px-4 py-3 text-sm md:grid-cols-[1fr_auto] md:items-center ${
                        selected
                          ? "border-teal-300 bg-teal-50 text-teal-950 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-50"
                          : "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{course.name}</span>
                          {selected ? <Badge className="bg-teal-100 text-teal-900">Selected</Badge> : null}
                        </div>
                        <div className="mt-1 text-xs text-slate-800 dark:text-slate-100">
                          {course.section ? `${course.section} / ${course.id}` : course.id}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={selected ? "primary" : "secondary"}
                          onClick={() => selectBindingCourse(course)}
                          disabled={packageIsLockdownOnly}
                        >
                          {selected ? "Using class" : "Use class"}
                        </Button>
                        <Button variant="secondary" onClick={() => removeLoadedCourse(course.id)}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <LabelledField label="Assignment">
              <select
                className={selectClassName}
                value={packageDraft.studentLmsBinding.assignmentId}
                disabled={packageIsLockdownOnly}
                onChange={(event) => {
                  const selectedAssignment = bindingCourseWork.find((item) => item.id === event.target.value);
                  updatePackage((current) => ({
                    ...current,
                    studentLmsBinding: {
                      ...current.studentLmsBinding,
                      assignmentId: event.target.value,
                      assignmentLabel: selectedAssignment?.title ?? current.studentLmsBinding.assignmentLabel
                    }
                  }));
                }}
              >
                <option value="">Load assignments from the selected class</option>
                {bindingCourseWork.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}{item.dueAt ? ` - due ${formatDateTime(item.dueAt) ?? item.dueAt}` : ""}
                  </option>
                ))}
              </select>
              <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                Use the teacher's existing school Google account. No new Lockedscreen account is needed.
              </div>
              <div className="mt-1 text-xs text-slate-800 dark:text-slate-100">
                The assignment ID is filled after you select an existing assignment with Load assignments, or after Post package to class creates the Classroom assignment. If the package is exported before the Classroom assignment exists, save and export it again after the assignment has been selected or posted.
              </div>
            </LabelledField>
            <Button
              variant="secondary"
              onClick={() => void handleLoadBindingCourseWork()}
              disabled={adminBusy || packageIsLockdownOnly || !packageDraft.studentLmsBinding.connectionId || !packageDraft.studentLmsBinding.courseId}
            >
              {isPending("load-lms-coursework") ? "Loading..." : "Load assignments"}
            </Button>
          </div>

          {packageDraft.studentLmsBinding.courseLabel ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Selected class: <span className="font-semibold text-slate-900 dark:text-slate-50">{packageDraft.studentLmsBinding.courseLabel}</span>
              <div className="mt-3">
                <Button variant="secondary" onClick={applyClassroomBindingToGradeSync} disabled={packageIsLockdownOnly}>
                  Set up grade sync for this class
                </Button>
              </div>
            </div>
          ) : null}

          {packageDraft.studentLmsBinding.provider === "google-classroom" ? (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
              <div className="font-semibold">Post this test to Google Classroom</div>
              <p className="mt-1">
                Lockedscreen will post a downloadable `.lscp` package and a direct download link as classwork in the
                selected class: {packageDraft.studentLmsBinding.courseLabel || "choose a class above first"}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => void handlePublishPackageToClassroom()}
                  disabled={
                    adminBusy ||
                    packageIsLockdownOnly ||
                    !packageDraft.studentLmsBinding.enabled ||
                    !packageDraft.studentLmsBinding.connectionId ||
                    !packageDraft.studentLmsBinding.courseId
                  }
                >
                  {isPending("publish-classroom-package") ? "Posting..." : "Post package to class"}
                </Button>
                {packageDraft.studentLmsBinding.assignmentLabel ? (
                  <Badge className="bg-white text-teal-900">Connected to {packageDraft.studentLmsBinding.assignmentLabel}</Badge>
                ) : null}
              </div>
            </div>
          ) : null}

          {isPending("load-lms-coursework") ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Loading assignments for the selected class...
            </div>
          ) : bindingCourseWork.length > 0 ? (
            <div className="grid gap-2">
              {bindingCourseWork.map((item) => {
                const selected = packageDraft.studentLmsBinding.assignmentId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      selected
                        ? "border-teal-500 bg-teal-50 text-teal-950 dark:border-teal-400 dark:bg-teal-950 dark:text-teal-50"
                        : "border-slate-200 bg-slate-50 text-slate-900 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    }`}
                    onClick={() => selectBindingAssignment(item)}
                    disabled={packageIsLockdownOnly}
                  >
                    <span className="block font-semibold text-slate-900 dark:text-slate-50">{item.title}</span>
                    <span className="mt-1 block text-xs">
                      {item.dueAt ? `Due ${formatDateTime(item.dueAt) ?? item.dueAt}` : "No due date listed"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : packageDraft.studentLmsBinding.courseId ? (
            <CardDescription>
              No assignments are loaded yet. Select a class or use Load assignments.
            </CardDescription>
          ) : null}

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Students</div>
                <div className="mt-1 text-xs text-slate-800 dark:text-slate-100">
                  All students in the selected class are assigned by default. Uncheck names to send the test to a smaller group.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void handleLoadBindingStudents()}
                  disabled={adminBusy || packageIsLockdownOnly || !packageDraft.studentLmsBinding.connectionId || !packageDraft.studentLmsBinding.courseId}
                >
                  {isPending("load-lms-students") ? "Loading..." : "Load students"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => applyStudentSelection(bindingStudents, new Set(bindingStudents.map(studentAccessId)))}
                  disabled={bindingStudents.length === 0 || adminBusy || packageIsLockdownOnly}
                >
                  Select all
                </Button>
              </div>
            </div>
            {bindingStudents.length > 0 ? (
              <div className="grid max-h-56 gap-2 overflow-auto pr-1 sm:grid-cols-2">
                {bindingStudents.map((student) => {
                  const accessId = studentAccessId(student);
                  const checked = selectedStudentIds.has(accessId);
                  return (
                    <label
                      key={accessId}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={checked}
                        disabled={packageIsLockdownOnly}
                        onChange={(event) => {
                          const nextIds = new Set(selectedStudentIds);
                          if (event.target.checked) {
                            nextIds.add(accessId);
                          } else {
                            nextIds.delete(accessId);
                          }
                          applyStudentSelection(bindingStudents, nextIds);
                        }}
                      />
                      <span>
                        <span className="block font-semibold text-slate-900 dark:text-slate-50">{student.name}</span>
                        <span className="block text-xs text-slate-900 dark:text-slate-100">{student.email || student.id}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-800 dark:text-slate-100">
                Load students after selecting a connected teacher account and class.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            Google and Microsoft app details are managed in the Admin Console connection settings. This package keeps only
            the selected teacher account, class, assignment, and student access list.
          </div>
        </Card>

        <Card className="space-y-5">
          <CardTitle>Turn-in notes</CardTitle>
          <div className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Exported packages carry only public LMS app settings plus the class and assignment IDs. Teacher access tokens never leave the admin device.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              The student signs in only after Lockedscreen has already recorded the local submission. LMS delivery is additive and can be retried from the post-submit screen.
            </div>
            {packageDraft.studentLmsBinding.courseLabel ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                Selected class: {packageDraft.studentLmsBinding.courseLabel}
              </div>
            ) : null}
            {packageDraft.studentLmsBinding.assignmentLabel ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                Selected assignment: {packageDraft.studentLmsBinding.assignmentLabel}
              </div>
            ) : null}
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Teachers sign in with their normal school account. If the school has not set up the app connection yet, a school IT/admin may need to complete that one-time setup before class lists and student turn-in can work.
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Posting a package to Classroom requires Google Classroom write permission and Google Drive file permission. If posting fails after an update, sign out and reconnect the teacher Google account so Google can ask for the new permissions.
            </div>
          </div>
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("results")} style={settingsTabStyle("results")}> 
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Result destinations</CardTitle>
              <CardDescription className="mt-2">
                Configure post-submission sync targets. Local results always remain stored in Lockedscreen first; remote delivery is additive and does not change the lockdown runtime.
              </CardDescription>
            </div>
            <Badge>{snapshot.resultDestinations.length} destination(s)</Badge>
          </div>

          {packageIsLockdownOnly ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              This package is set to lockdown-only use. Saved grade destinations stay available for other packages, but they are not exported or run for this package.
            </div>
          ) : null}

          <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Use selected Google Classroom setup</div>
                <div className="mt-1 text-teal-900 dark:text-teal-100">
                  Import the teacher account, class, assignment, and exam scope from Student turn-in into this grade-sync destination.
                </div>
                <div className="mt-3 grid gap-1 text-xs">
                  <span>Class: {packageDraft.studentLmsBinding.courseLabel || "Select a class in Student turn-in"}</span>
                  <span>Assignment: {packageDraft.studentLmsBinding.assignmentLabel || "Optional, or post the package to class first"}</span>
                  <span>Exam: {selectedExam?.title || packageDraft.label}</span>
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={applyClassroomBindingToGradeSync}
                disabled={packageIsLockdownOnly || !packageDraft.studentLmsBinding.connectionId || !packageDraft.studentLmsBinding.courseId}
              >
                Import Classroom details
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <LabelledField label="Selected destination">
              <select
                className={selectClassName}
                value={snapshot.resultDestinations.some((candidate) => candidate.id === selectedDestinationId) ? selectedDestinationId : "__new__"}
                onChange={(event) => {
                  if (event.target.value === "__new__") {
                    selectDestination(blankResultDestinationWithDefaults(settings));
                    return;
                  }

                  const selected = snapshot.resultDestinations.find((candidate) => candidate.id === event.target.value);
                  selectDestination(selected ?? null);
                }}
              >
                <option value="__new__">New destination</option>
                {snapshot.resultDestinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.label}
                  </option>
                ))}
              </select>
            </LabelledField>
            <div className="grid gap-3 md:grid-cols-2">
              <Button variant="secondary" onClick={() => void handleSaveDestination()} disabled={adminBusy}>
                {isPending("save-destination") ? "Saving..." : "Save destination"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleDeleteDestination()}
                disabled={adminBusy || !snapshot.resultDestinations.some((candidate) => candidate.id === destinationDraft.id)}
              >
                {isPending("delete-destination") ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField label="Provider">
              <select
                className={selectClassName}
                value={destinationDraft.type}
                onChange={(event) =>
                  updateDestination((current) => ({
                    ...current,
                    type: event.target.value as ResultDestinationType,
                    label:
                      current.label === "New destination" ||
                      current.label === providerLabel(current.type)
                        ? providerLabel(event.target.value as ResultDestinationType)
                        : current.label
                  }))
                }
              >
                <option value="google-classroom">Google Classroom</option>
                <option value="google-classroom-grade-sync">Google Classroom grade sync server</option>
                <option value="microsoft-teams">Microsoft Teams</option>
                <option value="google-sheets">Google Sheets</option>
                <option value="generic-lms">Generic LMS</option>
              </select>
            </LabelledField>
            <LabelledField label="Label">
              <Input
                value={destinationDraft.label}
                onChange={(event) => updateDestination((current) => ({ ...current, label: event.target.value }))}
              />
            </LabelledField>
            <LabelledField label="Trigger">
              <select
                className={selectClassName}
                value={destinationDraft.trigger}
                onChange={(event) =>
                  updateDestination((current) => ({
                    ...current,
                    trigger: event.target.value === "auto-on-submit" ? "auto-on-submit" : "manual"
                  }))
                }
              >
                <option value="manual">Manual sync from Results</option>
                <option value="auto-on-submit">Auto sync after submission</option>
              </select>
            </LabelledField>
            <ToggleField
              label="Destination enabled"
              checked={destinationDraft.enabled}
              onChange={(checked) => updateDestination((current) => ({ ...current, enabled: checked }))}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField
              label={
                destinationDraft.type === "google-classroom-grade-sync"
                  ? "Grade-sync server URL"
                  : destinationDraft.type === "google-sheets"
                    ? "Google Sheet link"
                    : "Endpoint URL"
              }
            >
              <Input
                placeholder={
                  destinationDraft.type === "google-classroom-grade-sync"
                    ? "https://school-sync.example.com/lockedscreen/grade-sync"
                    : destinationDraft.type === "google-sheets"
                      ? "https://docs.google.com/spreadsheets/d/..."
                      : "https://..."
                }
                value={destinationDraft.endpointUrl}
                onChange={(event) => updateDestination((current) => ({ ...current, endpointUrl: event.target.value }))}
              />
              {destinationDraft.type === "google-classroom-grade-sync" ? (
                <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                  This is not used for posting the package to Classroom. It is the school-owned server address that receives student scores after submission and writes grades back to Classroom.
                </div>
              ) : null}
            </LabelledField>
            {destinationDraft.type === "google-sheets" ? (
              <LabelledField label="Teacher Google account">
                <select
                  className={selectClassName}
                  value={destinationDraft.connectionId ?? ""}
                  onChange={(event) => updateDestination((current) => ({ ...current, connectionId: event.target.value }))}
                >
                  <option value="">Use connected Classroom account</option>
                  {snapshot.lmsConnections
                    .filter((connection) => connection.provider === "google-classroom" && connection.status === "connected")
                    .map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {lmsAccountOptionLabel(connection)}
                      </option>
                    ))}
                </select>
              </LabelledField>
            ) : null}
            {destinationDraft.type === "google-sheets" ? (
              <LabelledField label="School/Apps Script sync URL">
                <Input
                  placeholder={settings.defaultGoogleSheetsSyncEndpoint ? "Using admin default unless changed" : "https://script.google.com/macros/s/.../exec"}
                  value={destinationDraft.bridgeEndpointUrl ?? ""}
                  onChange={(event) =>
                    updateDestination((current) => ({ ...current, bridgeEndpointUrl: event.target.value }))
                  }
                />
                <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                  This is saved into the exported test package. Students do not enter it on their machines.
                </div>
              </LabelledField>
            ) : null}
            <LabelledField label="Auth mode">
              <select
                className={selectClassName}
                value={destinationDraft.authMode}
                onChange={(event) =>
                  updateDestination((current) => ({
                    ...current,
                    authMode: event.target.value as ResultSyncAuthMode
                  }))
                }
              >
                <option value="none">No auth</option>
                <option value="bearer">Bearer token</option>
                <option value="api-key">API key header</option>
              </select>
            </LabelledField>
            {destinationDraft.authMode !== "none" ? (
              <LabelledField label="Token / API key">
                <Input
                  type="password"
                  value={destinationDraft.authToken ?? ""}
                  onChange={(event) => updateDestination((current) => ({ ...current, authToken: event.target.value }))}
                />
              </LabelledField>
            ) : null}
            {destinationDraft.authMode === "api-key" ? (
              <LabelledField label="API key header">
                <Input
                  value={destinationDraft.apiKeyHeader ?? ""}
                  onChange={(event) => updateDestination((current) => ({ ...current, apiKeyHeader: event.target.value }))}
                />
              </LabelledField>
            ) : null}
            <LabelledField label="Class filter">
              <Input
                placeholder="Leave blank for all classes"
                value={destinationDraft.className ?? ""}
                onChange={(event) => updateDestination((current) => ({ ...current, className: event.target.value }))}
              />
            </LabelledField>
            <LabelledField
              label={
                destinationDraft.type === "google-sheets"
                  ? "Sheet tab name"
                  : destinationDraft.type === "google-classroom-grade-sync"
                    ? "Classroom course ID"
                    : "Provider reference"
              }
            >
              <Input
                placeholder={destinationDraft.type === "google-sheets" ? "Leave blank for first sheet" : "Course / channel / LMS id"}
                value={destinationDraft.type === "google-sheets" ? destinationDraft.sheetName ?? "" : destinationDraft.courseId ?? ""}
                onChange={(event) =>
                  updateDestination((current) => ({
                    ...current,
                    sheetName: current.type === "google-sheets" ? event.target.value : current.sheetName,
                    courseId: current.type === "google-sheets" ? current.courseId : event.target.value
                  }))
                }
              />
            </LabelledField>
            {destinationDraft.type === "google-classroom-grade-sync" ? (
              <LabelledField label="Classroom assignment ID">
                <Input
                  placeholder="Google Classroom courseWork ID"
                  value={destinationDraft.assignmentId ?? ""}
                  onChange={(event) =>
                    updateDestination((current) => ({
                      ...current,
                      assignmentId: event.target.value,
                      assignmentLabel: event.target.value.trim() === current.assignmentId?.trim() ? current.assignmentLabel : undefined
                    }))
                  }
                />
                {destinationDraft.assignmentLabel ? (
                  <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                    Assignment: {destinationDraft.assignmentLabel}
                  </div>
                ) : null}
                <div className="mt-1 text-xs text-slate-800 dark:text-slate-100">
                  This ID comes from Google Classroom after an assignment exists. Leave it blank only when the grade-sync server maps the Lockedscreen exam/package to the Classroom assignment itself.
                </div>
              </LabelledField>
            ) : null}
          </div>

          <LabelledField label="Exam scope">
            <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
              {snapshot.exams.map((exam) => (
                <label key={exam.id} className="flex items-center gap-3 text-sm text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    checked={destinationDraft.examIds.includes(exam.id)}
                    onChange={(event) =>
                      updateDestination((current) => ({
                        ...current,
                        examIds: event.target.checked
                          ? [...current.examIds, exam.id]
                          : current.examIds.filter((candidate) => candidate !== exam.id)
                      }))
                    }
                  />
                  {exam.title || "Untitled exam"}
                </label>
              ))}
            </div>
          </LabelledField>

          <ToggleField
            label="Include per-question responses in sync payload"
            checked={destinationDraft.includeResponses}
            onChange={(checked) => updateDestination((current) => ({ ...current, includeResponses: checked }))}
          />

          {destinationDraft.type === "google-sheets" ? (
            <ToggleField
              label="Sort Google Sheet by student last name"
              checked={destinationDraft.sortByLastName !== false}
              onChange={(checked) => updateDestination((current) => ({ ...current, sortByLastName: checked }))}
            />
          ) : null}

          <LabelledField label="Notes">
            <Textarea
              className="min-h-[110px]"
              value={destinationDraft.notes ?? ""}
              onChange={(event) => updateDestination((current) => ({ ...current, notes: event.target.value }))}
            />
          </LabelledField>
        </Card>

        <Card className="space-y-5">
          <CardTitle>Integration guidance</CardTitle>
          <div className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Google Sheets: teachers paste the Sheet link once while preparing the test. The exported package carries the Sheet target and sync URL to student machines; students do not configure Sheets.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Google Classroom grade sync server: point the endpoint URL to the school-owned grade-sync bridge. The app sends the local score; the server owns the teacher authorization and writes the grade into Classroom.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              The endpoint URL comes from the school IT/admin after they deploy the grade-sync bridge or Apps Script web app. It is usually a secure HTTPS address ending in an API route or `/exec`.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Microsoft Teams or generic LMS: use a school-owned middleware endpoint, webhook, or automation flow that receives Lockedscreen results and pushes them into the LMS.
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Security boundary: destination sync runs after submission from the teacher/admin side. It does not weaken the secure student session or change kiosk restrictions.
            </div>
          </div>
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("package")} style={settingsTabStyle("package")}> 
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-5">
          <CardTitle>General</CardTitle>
          <LabelledField label="Package label">
            <Input value={packageDraft.label} onChange={(event) => updatePackage((current) => ({ ...current, label: event.target.value }))} />
          </LabelledField>
          <LabelledField label="Description">
            <Textarea
              className="min-h-[110px]"
              value={packageDraft.description}
              onChange={(event) => updatePackage((current) => ({ ...current, description: event.target.value }))}
            />
          </LabelledField>
          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField label="Security level">
              <select
                className={selectClassName}
                value={packageDraft.securityMode}
                onChange={(event) =>
                  updatePackage((current) => ({
                    ...current,
                    securityMode: event.target.value === "full-kiosk" ? "full-kiosk" : "restricted-app"
                  }))
                }
              >
                <option value="restricted-app">Restricted App Mode</option>
                <option value="full-kiosk">Full Kiosk Mode</option>
              </select>
              <div className="mt-2 text-xs text-slate-800 dark:text-slate-100">
                Use Full Kiosk Mode with the native Windows companion verified to block the Windows key, task switching, task manager shortcuts, and the taskbar during exams.
              </div>
            </LabelledField>
            <LabelledField label="Package status">
              <select
                className={selectClassName}
                value={packageDraft.status}
                onChange={(event) =>
                  updatePackage((current) => ({
                    ...current,
                    status:
                      event.target.value === "archived"
                        ? "archived"
                        : event.target.value === "draft"
                          ? "draft"
                          : "active"
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </LabelledField>
          </div>
          <LabelledField label="Exam assignment">
            <select
              className={selectClassName}
              value={packageDraft.examId}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  examId: event.target.value,
                  sourceMode: snapshot.exams.find((candidate) => candidate.id === event.target.value)?.mode ?? current.sourceMode
                }))
              }
            >
              {snapshot.exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </LabelledField>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            Package checksum: <span className="font-mono text-xs">{packageDraft.integrity.checksum}</span>
          </div>
        </Card>

        <Card className="space-y-5">
          <CardTitle>Exam Source / Start URL</CardTitle>
          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField label="Runtime mode">
              <select
                className={selectClassName}
                value={packageDraft.sourceMode}
                onChange={(event) =>
                  updatePackage((current) => ({
                    ...current,
                    sourceMode: event.target.value === "link" ? "link" : "app"
                  }))
                }
              >
                <option value="app">Lockedscreen native exam</option>
                <option value="link">Hosted controlled exam</option>
              </select>
            </LabelledField>
            <LabelledField label="Browser display mode">
              <select
                className={selectClassName}
                value={packageDraft.browserPolicy.displayMode}
                onChange={(event) =>
                  updatePackage((current) => ({
                    ...current,
                    browserPolicy: {
                      ...current.browserPolicy,
                      displayMode: event.target.value as BrowserDisplayMode
                    }
                  }))
                }
              >
                <option value="minimal">Minimal</option>
                <option value="focus">Focus</option>
                <option value="immersive">Immersive</option>
              </select>
            </LabelledField>
          </div>
          <LabelledField label="Configured start URL">
            <Input
              value={packageDraft.browserPolicy.startUrl ?? ""}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  browserPolicy: {
                    ...current.browserPolicy,
                    startUrl: event.target.value
                  }
                }))
              }
            />
          </LabelledField>
          <LabelledField label="Support message">
            <Input
              value={packageDraft.teacherOptions.supportMessage ?? ""}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  teacherOptions: {
                    ...current.teacherOptions,
                    supportMessage: event.target.value
                  }
                }))
              }
            />
          </LabelledField>
          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
            Assigned exam: {selectedExam?.title ?? "None selected"}.
            Full Kiosk Mode is recommended when the package will be used for high-stakes delivery.
          </div>
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("student-access")} style={settingsTabStyle("student-access")}>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-5">
          <CardTitle>Student Assignment</CardTitle>
          <CardDescription>
            Limit this package to specific classes or student IDs. Leave both assignment lists blank to keep the exam visible to all students on the device.
          </CardDescription>
          <LabelledField label="Assigned classes">
            <Input
              placeholder="Year 10, Form 2A"
              value={serializeCommaList(packageDraft.studentAccessPolicy.assignedClassNames)}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  studentAccessPolicy: {
                    ...current.studentAccessPolicy,
                    assignedClassNames: splitCommaList(event.target.value)
                  }
                }))
              }
            />
          </LabelledField>
          <LabelledField label="Assigned student IDs">
            <Textarea
              className="min-h-[110px]"
              placeholder="stu-001, stu-002"
              value={serializeCommaList(packageDraft.studentAccessPolicy.assignedCandidateIds)}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  studentAccessPolicy: {
                    ...current.studentAccessPolicy,
                    assignedCandidateIds: splitCommaList(event.target.value)
                  }
                }))
              }
            />
          </LabelledField>
          <div className="grid gap-4 md:grid-cols-2">
            <LabelledField label="Available from">
              <Input
                type="datetime-local"
                value={packageDraft.studentAccessPolicy.availableFrom ?? ""}
                onChange={(event) =>
                  updatePackage((current) => ({
                    ...current,
                    studentAccessPolicy: {
                      ...current.studentAccessPolicy,
                      availableFrom: event.target.value
                    }
                  }))
                }
              />
            </LabelledField>
            <LabelledField label="Hide after">
              <Input
                type="datetime-local"
                value={packageDraft.studentAccessPolicy.availableUntil ?? ""}
                onChange={(event) =>
                  updatePackage((current) => ({
                    ...current,
                    studentAccessPolicy: {
                      ...current.studentAccessPolicy,
                      availableUntil: event.target.value
                    }
                  }))
                }
              />
            </LabelledField>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">Exam start code</div>
                <div className="mt-1 text-xs text-slate-800 dark:text-slate-100">
                  Optional. Students must enter this teacher-provided code before app-based or link-based exams can start.
                </div>
              </div>
              <Badge className={hasExamStartCode(packageDraft.studentAccessPolicy) ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"}>
                {hasExamStartCode(packageDraft.studentAccessPolicy) ? "Start code required" : "No start code"}
              </Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <LabelledField label="Set or replace start code">
                <Input
                  type="password"
                  placeholder={hasExamStartCode(packageDraft.studentAccessPolicy) ? "Enter a new code to replace" : "Enter code students will use"}
                  onChange={(event) => void setPackageStartCode(event.target.value)}
                />
              </LabelledField>
              <LabelledField label="Code hint shown to students">
                <Input
                  placeholder="Example: Ask your invigilator"
                  value={packageDraft.studentAccessPolicy.startCodeHint ?? ""}
                  onChange={(event) =>
                    updatePackage((current) => ({
                      ...current,
                      studentAccessPolicy: {
                        ...current.studentAccessPolicy,
                        startCodeHint: event.target.value
                      }
                    }))
                  }
                />
              </LabelledField>
              <Button
                variant="secondary"
                className="px-3 py-2"
                onClick={() =>
                  updatePackage((current) => ({
                    ...current,
                    studentAccessPolicy: {
                      ...current.studentAccessPolicy,
                      startCodeHash: undefined,
                      startCodeSalt: undefined,
                      startCodeHint: ""
                    }
                  }))
                }
                disabled={!hasExamStartCode(packageDraft.studentAccessPolicy) && !packageDraft.studentAccessPolicy.startCodeHint}
              >
                Clear code
              </Button>
            </div>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
              The exported exam package includes only a salted hash of the start code, never the plain code.
            </div>
          </div>
          <ToggleField
            label="Allow students to remove completed exams from their own list"
            checked={packageDraft.studentAccessPolicy.allowStudentDeletionAfterCompletion}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                studentAccessPolicy: {
                  ...current.studentAccessPolicy,
                  allowStudentDeletionAfterCompletion: checked
                }
              }))
            }
          />
        </Card>

        <Card className="space-y-5">
          <CardTitle>Assignment Notes</CardTitle>
          <div className="grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Matching rule: a student sees the exam when their class matches an assigned class, or their candidate ID matches an assigned student ID.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Completed exams stay visible but locked so the student cannot restart them.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              If you set a hide date, the exam disappears from the student portal after that time.
            </div>
          </div>
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("runtime")} style={settingsTabStyle("runtime")}>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="space-y-5">
          <CardTitle>Student Interface</CardTitle>
          <ToggleField
            label="Show school branding"
            checked={packageDraft.teacherOptions.showSchoolBranding}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                teacherOptions: {
                  ...current.teacherOptions,
                  showSchoolBranding: checked
                }
              }))
            }
          />
          <ToggleField
            label="Show candidate identity"
            checked={packageDraft.teacherOptions.showCandidateId}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                teacherOptions: {
                  ...current.teacherOptions,
                  showCandidateId: checked
                }
              }))
            }
          />
          <ToggleField
            label="Show countdown timer"
            checked={packageDraft.teacherOptions.showTimer}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                teacherOptions: {
                  ...current.teacherOptions,
                  showTimer: checked
                }
              }))
            }
          />
          <ToggleField
            label="Show student score after submission"
            checked={packageDraft.teacherOptions.showScoreAfterSubmit}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                teacherOptions: {
                  ...current.teacherOptions,
                  showScoreAfterSubmit: checked
                }
              }))
            }
          />
        </Card>

        <Card className="space-y-5">
          <CardTitle>Browser / Runtime</CardTitle>
          <ToggleField
            label="Hide general browser chrome"
            checked={packageDraft.browserPolicy.restrictNavigationChrome}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                browserPolicy: {
                  ...current.browserPolicy,
                  restrictNavigationChrome: checked
                }
              }))
            }
          />
          <ToggleField
            label="Show back-to-start control"
            checked={packageDraft.browserPolicy.showBackToStartButton}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                browserPolicy: {
                  ...current.browserPolicy,
                  showBackToStartButton: checked
                }
              }))
            }
          />
          <ToggleField
            label="Protect back-to-start"
            checked={packageDraft.browserPolicy.protectedBackToStart}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                browserPolicy: {
                  ...current.browserPolicy,
                  protectedBackToStart: checked
                }
              }))
            }
          />
          <ToggleField
            label="Allow context menu"
            checked={packageDraft.browserPolicy.allowContextMenu}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                browserPolicy: {
                  ...current.browserPolicy,
                  allowContextMenu: checked
                }
              }))
            }
          />
        </Card>

        <Card className="space-y-5">
          <CardTitle>Session Handling</CardTitle>
          <ToggleField
            label="Clear browser session on start"
            checked={packageDraft.sessionPolicy.clearSessionOnStart}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                sessionPolicy: {
                  ...current.sessionPolicy,
                  clearSessionOnStart: checked
                }
              }))
            }
          />
          <ToggleField
            label="Clear browser session on end"
            checked={packageDraft.sessionPolicy.clearSessionOnEnd}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                sessionPolicy: {
                  ...current.sessionPolicy,
                  clearSessionOnEnd: checked
                }
              }))
            }
          />
          <ToggleField
            label="Ask before quit"
            checked={packageDraft.sessionPolicy.askBeforeQuit}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                sessionPolicy: {
                  ...current.sessionPolicy,
                  askBeforeQuit: checked
                }
              }))
            }
          />
          <ToggleField
            label="Allow student exit immediately after submit"
            checked={packageDraft.sessionPolicy.allowExitAfterSubmit}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                sessionPolicy: {
                  ...current.sessionPolicy,
                  allowExitAfterSubmit: checked
                }
              }))
            }
          />
          <ToggleField
            label="Require invigilator PIN to leave after submit"
            checked={packageDraft.quitUnlockPolicy.requireInvigilatorPin}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                quitUnlockPolicy: {
                  ...current.quitUnlockPolicy,
                  requireInvigilatorPin: checked
                }
              }))
            }
          />
          <ToggleField
            label="Restart session instead of quit"
            checked={packageDraft.sessionPolicy.restartInsteadOfQuit}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                sessionPolicy: {
                  ...current.sessionPolicy,
                  restartInsteadOfQuit: checked
                }
              }))
            }
          />
          <LabelledField label="Exit URL after exam">
            <Input
              value={packageDraft.sessionPolicy.exitUrl ?? ""}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  sessionPolicy: {
                    ...current.sessionPolicy,
                    exitUrl: event.target.value || undefined
                  }
                }))
              }
            />
          </LabelledField>
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("controls")} style={settingsTabStyle("controls")}>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-5">
          <CardTitle>Applications</CardTitle>
          <CardDescription>
            One approved app per line in the format `Label|Path|args|launch-and-monitor|Notes`.
          </CardDescription>
          <Textarea
            className="min-h-[180px] font-mono text-xs"
            value={allowedAppsText}
            onChange={(event) => {
              setPackageDirty(true);
              setAllowedAppsText(event.target.value);
            }}
          />
          <LabelledField label="Allowed process names">
            <Textarea
              className="min-h-[120px]"
              value={packageDraft.processPolicy.allowedProcessNames.join("\n")}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  processPolicy: {
                    ...current.processPolicy,
                    allowedProcessNames: splitLines(event.target.value)
                  }
                }))
              }
            />
          </LabelledField>
          <LabelledField label="Disallowed process names">
            <Textarea
              className="min-h-[120px]"
              value={packageDraft.processPolicy.disallowedProcessNames.join("\n")}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  processPolicy: {
                    ...current.processPolicy,
                    disallowedProcessNames: splitLines(event.target.value)
                  }
                }))
              }
            />
          </LabelledField>
        </Card>

        <Card className="space-y-5">
          <CardTitle>Network / URL Filter</CardTitle>
          <LabelledField label="Allowed domains">
            <Textarea
              className="min-h-[120px]"
              value={packageDraft.browserPolicy.allowedDomains.join("\n")}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  browserPolicy: {
                    ...current.browserPolicy,
                    allowedDomains: splitLines(event.target.value)
                  }
                }))
              }
            />
          </LabelledField>
          <LabelledField label="URL rules">
            <Textarea
              className="min-h-[180px] font-mono text-xs"
              value={urlRulesText}
              onChange={(event) => {
                setPackageDirty(true);
                setUrlRulesText(event.target.value);
              }}
            />
          </LabelledField>
          <ToggleField
            label="Preserve query parameters when returning to start URL"
            checked={packageDraft.browserPolicy.preserveQueryParameters}
            onChange={(checked) =>
              updatePackage((current) => ({
                ...current,
                browserPolicy: {
                  ...current.browserPolicy,
                  preserveQueryParameters: checked
                }
              }))
            }
          />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="space-y-5">
          <CardTitle>Clipboard / Capture / Printing</CardTitle>
          <PolicySelect
            label="Clipboard policy"
            value={packageDraft.clipboardPolicy.mode}
            options={["allow", "block-copy", "block-all"]}
            onChange={(value) =>
              updatePackage((current) => ({
                ...current,
                clipboardPolicy: {
                  ...current.clipboardPolicy,
                  mode: value as ExamConfigPackage["clipboardPolicy"]["mode"]
                }
              }))
            }
          />
          <PolicySelect
            label="Screen capture policy"
            value={packageDraft.capturePolicy.mode}
            options={["allow-in-app-only", "block-shortcuts", "advisory-only"]}
            onChange={(value) =>
              updatePackage((current) => ({
                ...current,
                capturePolicy: {
                  ...current.capturePolicy,
                  mode: value as ExamConfigPackage["capturePolicy"]["mode"]
                }
              }))
            }
          />
          <PolicySelect
            label="Printing policy"
            value={packageDraft.printPolicy.mode}
            options={["allow", "block"]}
            onChange={(value) =>
              updatePackage((current) => ({
                ...current,
                printPolicy: {
                  ...current.printPolicy,
                  mode: value as ExamConfigPackage["printPolicy"]["mode"]
                }
              }))
            }
          />
        </Card>

        <Card className="space-y-5">
          <CardTitle>Key Restrictions</CardTitle>
          <LabelledField label="Policy metadata">
            <Textarea
              className="min-h-[130px]"
              value={packageDraft.keyRestrictionPolicy.metadata}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  keyRestrictionPolicy: {
                    ...current.keyRestrictionPolicy,
                    metadata: event.target.value
                  }
                }))
              }
            />
          </LabelledField>
          <LabelledField label="Blocked shortcuts">
            <Textarea
              className="min-h-[130px]"
              value={packageDraft.keyRestrictionPolicy.blockedShortcuts.join("\n")}
              onChange={(event) =>
                updatePackage((current) => ({
                  ...current,
                  keyRestrictionPolicy: {
                    ...current.keyRestrictionPolicy,
                    blockedShortcuts: splitLines(event.target.value)
                  }
                }))
              }
            />
          </LabelledField>
        </Card>

        <AppUpdateSettingsCard state={settingsUpdateState} />

        <Card className="space-y-5">
          <CardTitle>Kiosk / Lockdown</CardTitle>
          <LabelledField label="Invigilator unlock PIN">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={settings.invigilatorUnlockPin}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  invigilatorUnlockPin: event.target.value
                }))
              }
            />
          </LabelledField>
          <LabelledField label="Admin advanced settings PIN">
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={settings.adminUnlockPin}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  adminUnlockPin: event.target.value
                }))
              }
            />
          </LabelledField>
          <LabelledField label="Default theme">
            <select
              className={selectClassName}
              value={settings.defaultTheme}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  defaultTheme: event.target.value as ThemePreference
                }))
              }
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </LabelledField>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              checked={settings.allowElectronKioskAssist}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  allowElectronKioskAssist: event.target.checked
                }))
              }
            />
            Enable Electron window assist during active sessions
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <input
              type="checkbox"
              className="size-4 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
              checked={settings.allowNonKioskTestingMode || autoTestingMode}
              disabled={autoTestingMode}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  allowNonKioskTestingMode: event.target.checked
                }))
              }
            />
            {autoTestingMode
              ? "Windows Home detected without a verified native lockdown companion. Testing sessions are enabled automatically on this device."
              : "Allow testing sessions when native lockdown or official kiosk deployment is not verified"}
          </label>
          {snapshot?.runtime ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              Runtime: {snapshot.runtime.platform}
              {snapshot.runtime.platform === "windows" ? ` / ${snapshot.runtime.windowsEdition ?? "unknown"} edition` : ""}
              . Native companion {snapshot.runtime.nativeLockdown.lockdownCapable ? "active" : snapshot.runtime.nativeLockdown.featureLevel === "partial" ? "partial" : "not detected"}.
              . Assigned Access {snapshot.runtime.supportsAssignedAccess ? "available" : "unavailable"}.
              Shell Launcher {snapshot.runtime.supportsShellLauncher ? "available" : "unavailable"}.
            </div>
          ) : null}
        </Card>
      </div>
      </div>

      <div className={settingsTabClass("security")} style={settingsTabStyle("security")}>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-5">
          <CardTitle>Security posture</CardTitle>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              checked={security.kioskConfigured}
              onChange={(event) =>
                updateSecurity((current) => ({
                  ...current,
                  kioskConfigured: event.target.checked
                }))
              }
            />
            Official Windows kiosk deployment is configured when used
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              checked={security.nativeCompanionVerified}
              onChange={(event) =>
                updateSecurity((current) => ({
                  ...current,
                  nativeCompanionVerified: event.target.checked
                }))
              }
            />
            Native Windows lockdown companion is installed and verified
          </label>
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              checked={security.dedicatedExamAccount}
              onChange={(event) =>
                updateSecurity((current) => ({
                  ...current,
                  dedicatedExamAccount: event.target.checked
                }))
              }
            />
            Dedicated exam user account is provisioned
          </label>
          <LabelledField label="Deployment mechanism">
            <select
              className={selectClassName}
              value={security.kioskMode}
              onChange={(event) =>
                updateSecurity((current) => ({
                  ...current,
                  kioskMode:
                    event.target.value === "assigned-access"
                      ? "assigned-access"
                      : event.target.value === "shell-launcher"
                        ? "shell-launcher"
                        : event.target.value === "windows-native-companion"
                          ? "windows-native-companion"
                          : event.target.value === "hybrid"
                            ? "hybrid"
                        : "not-configured"
                }))
              }
            >
              <option value="not-configured">Not configured</option>
              <option value="windows-native-companion">Native Windows companion</option>
              <option value="assigned-access">Assigned Access</option>
              <option value="shell-launcher">Shell Launcher</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </LabelledField>
          <LabelledField label="Last verified">
            <Input
              type="datetime-local"
              value={security.lastVerifiedAt ? security.lastVerifiedAt.slice(0, 16) : ""}
              onChange={(event) =>
                updateSecurity((current) => ({
                  ...current,
                  lastVerifiedAt: event.target.value ? new Date(event.target.value).toISOString() : undefined
                }))
              }
            />
          </LabelledField>
        </Card>

        <Card className="space-y-5">
          <CardTitle>Diagnostics & logging</CardTitle>
          <div className="grid gap-3">
            {securityOverview?.packageSummaries.map((summary) => (
              <StatusChip
                key={summary.packageId}
                title={summary.label}
                subtitle={`${summary.securityMode} · ${summary.detail}`}
                status={summary.status}
              />
            ))}
          </div>
          <div className="grid gap-3">
            {securityOverview?.environmentChecks.map((check) => (
              <StatusChip
                key={check.id}
                title={check.label}
                subtitle={`${check.detail} ${check.observedValue ? `(${check.observedValue})` : ""}`}
                status={check.status}
              />
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
            Process monitor: {securityOverview?.processSummary.monitored ? "active" : "not active"}.
            Allowed {securityOverview?.processSummary.allowed ?? 0}, review {securityOverview?.processSummary.review ?? 0},
            disallowed {securityOverview?.processSummary.disallowed ?? 0}.
          </div>
          <div className="max-h-[220px] space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            {snapshot.securityLogs.slice(0, 10).map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <div className="font-medium text-slate-900 dark:text-slate-50">
                  {entry.category} · {entry.severity}
                </div>
                <div className="mt-1">{entry.message}</div>
                <div className="mt-1 text-xs text-slate-900 dark:text-slate-100">{new Date(entry.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      </div>
    </motion.div>
  );
};

const updateStatusLabel = (state: AppUpdateState | null): string => {
  if (!state) {
    return "Loading update status";
  }

  return state.status === "idle"
    ? "Not checked yet"
    : state.status === "checking"
      ? "Checking for updates"
      : state.status === "available"
        ? `Version ${state.availableVersion ?? "update"} available`
        : state.status === "not-available"
          ? "Up to date"
          : state.status === "downloading"
            ? `Downloading${typeof state.percent === "number" ? ` ${state.percent}%` : ""}`
            : state.status === "downloaded"
              ? "Ready to install"
              : "Update check failed";
};

const updateCardTone = (state: AppUpdateState | null): string => {
  if (!state || state.status === "idle" || state.status === "checking" || state.status === "not-available") {
    return "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
  }

  if (state.status === "error") {
    return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/60 dark:text-amber-100";
  }

  return "border-teal-200 bg-teal-50 text-teal-950 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-50";
};

const AppUpdateSettingsCard = ({ state }: { state: AppUpdateState | null }) => {
  const checking = state?.status === "checking";
  const downloading = state?.status === "downloading";
  const canDownload = state?.status === "available";
  const canInstall = state?.status === "downloaded";

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>App Updates</CardTitle>
          <CardDescription className="mt-2">
            Installed users can check, download, and install app updates from this device when no exam is active.
          </CardDescription>
        </div>
        <Badge>{state?.currentVersion ? `v${state.currentVersion}` : "Version"}</Badge>
      </div>

      <div className={`rounded-2xl border px-4 py-3 text-sm ${updateCardTone(state)}`}>
        <div className="font-semibold">{updateStatusLabel(state)}</div>
        {state?.message ? <div className="mt-1">{state.message}</div> : null}
        {state?.releaseName ? <div className="mt-1">Release: {state.releaseName}</div> : null}
        {state?.releaseDate ? <div className="mt-1">Published: {formatDateTime(state.releaseDate) ?? state.releaseDate}</div> : null}
        {downloading ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-900">
            <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(0, Math.min(100, state.percent ?? 0))}%` }} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void window.lockedscreenApi.checkForUpdates()} disabled={checking || downloading}>
          {checking ? "Checking..." : "Check for updates"}
        </Button>
        {canDownload ? (
          <Button variant="secondary" onClick={() => void window.lockedscreenApi.downloadUpdate()}>
            <Download className="size-4" />
            Download update
          </Button>
        ) : null}
        {canInstall ? (
          <Button onClick={() => void window.lockedscreenApi.installUpdate()}>
            Install now
          </Button>
        ) : null}
      </div>
    </Card>
  );
};

const UpdateBanner = ({ state }: { state: AppUpdateState }) => {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const visible =
    state.status === "available" ||
    state.status === "downloading" ||
    state.status === "downloaded" ||
    state.status === "installing" ||
    state.status === "installed" ||
    state.status === "error";

  if (!visible || dismissedVersion === `${state.status}:${state.availableVersion ?? state.message ?? ""}`) {
    return null;
  }

  const title =
    state.status === "available"
      ? `Lockedscreen ${state.availableVersion} is available`
      : state.status === "downloaded"
        ? "Update ready to install"
        : state.status === "installing"
          ? "Installing Lockedscreen update"
          : state.status === "installed"
            ? `Lockedscreen ${state.currentVersion} update complete`
            : state.status === "downloading"
              ? "Downloading Lockedscreen update"
              : "Update check needs attention";
  const message =
    state.message ??
    (state.status === "available"
      ? "Download this update when the device is not in an active exam."
      : state.status === "installed"
        ? "The update has finished installing."
        : "Lockedscreen could not complete the update check.");

  return (
    <div className="mb-4 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950 shadow-sm dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-50">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="mt-1 text-teal-900 dark:text-teal-100">{message}</div>
          {state.status === "available" || state.status === "downloaded" ? (
            <div className="mt-1 text-teal-900 dark:text-teal-100">
              This release includes formatted math, equation, and question image authoring updates.
            </div>
          ) : null}
          {state.status === "downloading" ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-900">
              <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(0, Math.min(100, state.percent ?? 0))}%` }} />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {state.status === "available" ? (
            <Button variant="secondary" onClick={() => void window.lockedscreenApi.downloadUpdate()}>
              <Download className="size-4" />
              Download update
            </Button>
          ) : null}
          {state.status === "downloaded" ? (
            <Button onClick={() => void window.lockedscreenApi.installUpdate()}>
              Install now
            </Button>
          ) : null}
          {state.status === "installing" ? (
            <Button disabled>
              <Loader2 className="size-4 animate-spin" />
              Installing
            </Button>
          ) : null}
          {state.status === "error" ? (
            <Button variant="secondary" onClick={() => void window.lockedscreenApi.checkForUpdates()}>
              Check again
            </Button>
          ) : null}
          {state.status !== "installing" ? (
            <Button
              variant="secondary"
              onClick={() => setDismissedVersion(`${state.status}:${state.availableVersion ?? state.message ?? ""}`)}
            >
              {state.status === "installed" ? "Dismiss" : "Later"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const AppVersionStatus = ({ state }: { state: AppUpdateState | null }) => {
  const label = state?.currentVersion ? `Lockedscreen v${state.currentVersion}` : `Lockedscreen v${desktopPackage.version}`;
  const status =
    state?.status === "available"
      ? `Update ${state.availableVersion ?? ""} available`.trim()
      : state?.status === "downloaded"
        ? "Update ready"
        : state?.status === "installing"
          ? "Installing update"
          : state?.status === "installed"
            ? "Update complete"
        : state?.status === "downloading"
          ? `Downloading${typeof state.percent === "number" ? ` ${state.percent}%` : ""}`
          : state?.status === "checking"
            ? "Checking updates"
            : state?.status === "not-available"
              ? "Up to date"
              : state?.status === "error"
                ? "Update check failed"
                : "Update not checked";
  const busy = state?.status === "checking" || state?.status === "downloading" || state?.status === "installing";
  const action =
    state?.status === "available"
      ? {
          label: "Download update",
          icon: <Download className="size-4" />,
          onClick: () => void window.lockedscreenApi.downloadUpdate(),
          disabled: false
        }
      : state?.status === "downloaded"
        ? {
            label: "Install update",
            icon: null,
            onClick: () => void window.lockedscreenApi.installUpdate(),
            disabled: false
          }
        : state?.status === "downloading"
          ? {
              label: typeof state.percent === "number" ? `Downloading ${state.percent}%` : "Downloading",
              icon: <Loader2 className="size-4 animate-spin" />,
              onClick: () => undefined,
              disabled: true
            }
          : state?.status === "checking"
            ? {
                label: "Checking",
                icon: <Loader2 className="size-4 animate-spin" />,
                onClick: () => undefined,
                disabled: true
              }
            : state?.status === "installing"
              ? {
                  label: "Installing",
                  icon: <Loader2 className="size-4 animate-spin" />,
                  onClick: () => undefined,
                  disabled: true
                }
              : {
                  label: state?.status === "error" ? "Check again" : "Check for updates",
                  icon: null,
                  onClick: () => void window.lockedscreenApi.checkForUpdates(),
                  disabled: false
                };

  return (
    <div className="fixed bottom-3 right-3 z-40 max-w-[calc(100vw-1.5rem)]">
      <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-950/95 dark:text-slate-100 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <span>{label}</span>
          <span className="mx-2 text-slate-400">|</span>
          <span>{status}</span>
        </div>
        <Button
          variant={state?.status === "downloaded" ? "primary" : "secondary"}
          className="h-8 shrink-0 px-3 text-xs"
          onClick={action.onClick}
          disabled={busy || action.disabled}
        >
          {action.icon}
          {action.label}
        </Button>
      </div>
    </div>
  );
};

const StudentLmsTurnInPanel = ({
  configPackage,
  submission,
  turningIn,
  onTurnIn
}: {
  configPackage: ExamConfigPackage | null;
  submission: SubmissionResult | null;
  turningIn: boolean;
  onTurnIn: () => void;
}) => {
  const binding = configPackage?.studentLmsBinding;
  if (!binding?.enabled || !submission) {
    return null;
  }

  const state = submission.studentLmsTurnIn;
  const status = state?.status ?? "pending";
  const actionLabel = status === "success" ? "Turned in" : turningIn ? "Connecting..." : "Turn in to LMS";

  return (
    <Card className="space-y-4 border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge className={studentTurnInTone(status)}>{providerLabel(binding.provider)} turn-in</Badge>
          <CardTitle className="mt-3">{binding.assignmentLabel || binding.assignmentId || "Assignment link ready"}</CardTitle>
          <CardDescription className="mt-2 text-slate-900 dark:text-slate-100">
            Sign in with the student LMS account to attach the Lockedscreen submission and complete the turn-in.
          </CardDescription>
        </div>
        <Button className="px-3 py-2" onClick={onTurnIn} disabled={turningIn || status === "success"}>
          {actionLabel}
        </Button>
      </div>
      {binding.courseLabel || binding.courseId ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          Class: {binding.courseLabel || binding.courseId}
        </div>
      ) : null}
      {state?.lastError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{state.lastError}</div>
      ) : null}
      {binding.provider === "google-classroom" && state?.gradeSyncStatus ? (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            state.gradeSyncStatus === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : state.gradeSyncStatus === "failed"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          }`}
        >
          Grade sync: {state.gradeSyncStatus}
          {typeof state.gradeValue === "number" ? ` (${state.gradeValue} points)` : ""}
          {state.gradeSyncError ? ` - ${state.gradeSyncError}` : ""}
        </div>
      ) : null}
      {state?.externalReference ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm break-all text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
          LMS reference: {state.externalReference}
        </div>
      ) : null}
    </Card>
  );
};

const StudentExamPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { examId } = useParams();
  const { snapshot, submitExam, turnInStudentLms, beginSession, endSession } = useLockedscreenStore();
  const exam = snapshot?.exams.find((candidate) => candidate.id === examId);
  const configPackage = examId ? getConfigPackageForExam(snapshot ?? null, examId) : null;
  const sessionExamId = exam?.id ?? null;
  const sessionPackageId = configPackage?.id ?? null;
  const fallbackCandidateRef = useRef<Candidate | null>(null);
  if (!fallbackCandidateRef.current) {
    fallbackCandidateRef.current = defaultCandidate();
  }
  const launchCandidate = parseCandidateFromSearch(location.search) ?? fallbackCandidateRef.current;
  const [session, setSession] = useState<ExamSession | null>(() =>
    exam ? createSession(exam, launchCandidate) : null
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [turningIn, setTurningIn] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const sessionEndedRef = useRef(false);

  const endCurrentSession = useCallback(
    async (reason: string): Promise<boolean> => {
      if (sessionEndedRef.current) {
        return true;
      }

      sessionEndedRef.current = true;
      try {
        return await waitForSessionRelease(endSession(reason));
      } catch (error) {
        sessionEndedRef.current = false;
        throw error;
      }
    },
    [endSession]
  );

  const releaseToStudentPortal = useCallback(async () => {
    await endCurrentSession("Invigilator released native exam runtime");
    navigate("/student", { replace: true });
  }, [endCurrentSession, navigate]);

  useEffect(() => {
    if (!sessionExamId || !sessionPackageId) {
      return;
    }

    sessionEndedRef.current = false;
    void beginSession({ examId: sessionExamId, packageId: sessionPackageId, mode: "app" });
    return () => {
      void endCurrentSession("Closed native exam runtime");
    };
  }, [beginSession, endCurrentSession, sessionExamId, sessionPackageId]);

  useEffect(() => {
    if (!exam) {
      return;
    }

    setSession(createSession(exam, launchCandidate));
    setCurrentIndex(0);
    setSubmitted(false);
    setSubmitting(false);
    setTurningIn(false);
    setSubmissionResult(null);
  }, [exam, location.search]);

  const handleStudentTurnIn = async (submissionId: string) => {
    if (!configPackage) {
      return;
    }

    setTurningIn(true);
    const updatedSubmission = await turnInStudentLms({ submissionId, packageId: configPackage.id });
    if (updatedSubmission) {
      setSubmissionResult(updatedSubmission);
    }
    setTurningIn(false);
  };

  const finalize = async () => {
    if (submitted || submitting || !session || !exam) {
      return;
    }

    setSubmitting(true);
    const result = await submitExam(exam, session);
    if (!result) {
      setSubmitting(false);
      return;
    }

    setSubmissionResult(result);
    setSubmitted(true);
    setSubmitting(false);
    if (configPackage?.studentLmsBinding.enabled) {
      void handleStudentTurnIn(result.id);
      return;
    }

    if (!requiresInvigilatorExitAfterSubmit(configPackage) && configPackage?.sessionPolicy.allowExitAfterSubmit) {
      navigate("/student");
    }
  };

  useEffect(() => {
    if (!session || submitted) {
      return;
    }

    const timer = window.setInterval(() => {
      if (getRemainingSeconds(session) === 0) {
        window.clearInterval(timer);
        if (configPackage?.sessionPolicy.timeoutAction === "restart" && exam) {
          setSession(createSession(exam, session.candidate));
          setCurrentIndex(0);
          return;
        }
        void finalize();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [configPackage?.sessionPolicy.timeoutAction, exam, session, submitted]);

  if (!exam || !session) {
    return null;
  }

  const question = exam.questions[currentIndex];
  const response = session.responses.find((entry) => entry.questionId === question?.id);

  return (
    <StudentShell
      exam={exam}
      configPackage={configPackage}
      session={session}
      sessionSubmitted={submitted}
      secureMode={snapshot ? isSecureSessionReady(snapshot) : false}
      testingModeName={snapshot ? testingModeLabel(snapshot) : "Testing mode"}
      unlockPin={snapshot?.settings.invigilatorUnlockPin ?? ""}
      onUnlock={releaseToStudentPortal}
    >
      {submitted ? (
        <div className="space-y-4">
          <Card className="space-y-4 border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-50">
            <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">Submission recorded</Badge>
            <CardTitle className="text-emerald-950 dark:text-emerald-50">Your exam has been submitted.</CardTitle>
              <CardDescription className="text-emerald-900 dark:text-emerald-100">
                Lockedscreen saved the local submission first. Wait for the invigilator before leaving this screen. If this
                package requires invigilator-controlled exit, the session remains locked until the invigilator unlocks it.
              </CardDescription>
              {configPackage?.teacherOptions.showScoreAfterSubmit && submissionResult ? (
                <div className="rounded-2xl border border-emerald-300 bg-white px-4 py-3 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900 dark:text-emerald-50">
                  <div className="text-sm font-semibold">Score</div>
                  <div className="mt-1 text-2xl font-bold">
                    {submissionResult.score}/{submissionResult.totalPoints} ({submissionResult.percentage}%)
                  </div>
                </div>
              ) : null}
            </Card>
          <StudentLmsTurnInPanel
            configPackage={configPackage}
            submission={submissionResult}
            turningIn={turningIn}
            onTurnIn={() => {
              if (submissionResult) {
                void handleStudentTurnIn(submissionResult.id);
              }
            }}
          />
        </div>
      ) : question ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(11rem,0.24fr)_minmax(0,0.76fr)]">
          <Card className="space-y-3 p-4">
            <Badge className="bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-100">Question map</Badge>
            <div className="grid grid-cols-5 gap-1.5">
              {exam.questions.map((candidate, index) => {
                const candidateResponse = session.responses.find((entry) => entry.questionId === candidate.id);
                const answered = Boolean(candidateResponse?.selectedOptionId);
                return (
                  <button
                    key={candidate.id}
                    className={`rounded-xl px-2.5 py-2 text-sm font-semibold transition ${
                      index === currentIndex
                        ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                        : answered
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
                          : "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                    }`}
                    onClick={() => setCurrentIndex(index)}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
            <div className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100">
              Completion: {Math.round(calculateCompletion(session) * 100)}%
            </div>
          </Card>

          <Card className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Badge>Question {currentIndex + 1}</Badge>
                <RichContent content={question.prompt} className="mt-3 text-lg leading-7 text-slate-900 dark:text-slate-50" />
              </div>
              <Badge className="bg-slate-900 text-white">{question.points} pt</Badge>
            </div>

            <div className="grid gap-2.5">
              {question.options.map((option) => (
                <button
                  key={option.id}
                  className={`rounded-[20px] border px-4 py-3 text-left text-base transition ${
                    response?.selectedOptionId === option.id
                      ? "border-teal-500 bg-teal-50 text-teal-950 shadow-glow dark:border-teal-300 dark:bg-teal-950 dark:text-teal-50"
                      : "border-slate-300 bg-white text-slate-900 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50 dark:hover:border-slate-400"
                  }`}
                  onClick={() =>
                    setSession({
                      ...session,
                      responses: updateResponse(session.responses, question.id, {
                        selectedOptionId: option.id
                      })
                    })
                  }
                >
                  <div className="font-semibold">{option.label}</div>
                  <RichContent
                    content={option.content}
                    className={`mt-1.5 ${
                      response?.selectedOptionId === option.id
                        ? "text-teal-900 dark:text-teal-50"
                        : "text-slate-900 dark:text-slate-100"
                    }`}
                  />
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="px-3 py-2"
                  onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))}
                  disabled={currentIndex === 0}
                >
                  <ArrowLeft className="size-4" />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  className="px-3 py-2"
                  onClick={() =>
                    setSession({
                      ...session,
                      responses: updateResponse(session.responses, question.id, {
                        flagged: !response?.flagged
                      })
                    })
                  }
                >
                  <Flag className="size-4" />
                  {response?.flagged ? "Unflag" : "Flag"}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  className="px-3 py-2"
                  onClick={() => setCurrentIndex((value) => Math.min(exam.questions.length - 1, value + 1))}
                  disabled={currentIndex === exam.questions.length - 1}
                >
                  Next
                  <ArrowRight className="size-4" />
                </Button>
                <Button variant="danger" className="px-3 py-2" onClick={() => void finalize()} disabled={submitting}>
                  {submitting ? "Submitting..." : "Submit exam"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </StudentShell>
  );
};

const LinkExamPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { examId } = useParams();
  const { snapshot, submitExam, turnInStudentLms, beginSession, endSession } = useLockedscreenStore();
  const exam = snapshot?.exams.find((candidate) => candidate.id === examId);
  const configPackage = examId ? getConfigPackageForExam(snapshot ?? null, examId) : null;
  const sessionExamId = exam?.id ?? null;
  const sessionPackageId = configPackage?.id ?? null;
  const fallbackCandidateRef = useRef<Candidate | null>(null);
  if (!fallbackCandidateRef.current) {
    fallbackCandidateRef.current = defaultCandidate();
  }
  const launchCandidate = parseCandidateFromSearch(location.search) ?? fallbackCandidateRef.current;
  const [session, setSession] = useState<ExamSession | null>(() =>
    exam ? createSession(exam, launchCandidate) : null
  );
  const [expired, setExpired] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [turningIn, setTurningIn] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [shellUnlockOpen, setShellUnlockOpen] = useState(false);
  const [hostedZoom, setHostedZoom] = useState(1);
  const [hostedSubmitDetected, setHostedSubmitDetected] = useState(false);
  const [embeddedGoogleSignInBlocked, setEmbeddedGoogleSignInBlocked] = useState(false);
  const webviewRef = useRef<any>(null);
  const sessionEndedRef = useRef(false);
  const guardDomainsKey = configPackage?.browserPolicy.allowedDomains.join("|") ?? "";
  const guardPrefixesKey =
    configPackage?.browserPolicy.urlRules
      .filter((rule) => rule.kind === "prefix")
      .map((rule) => rule.pattern)
      .join("|") ?? "";

  const endCurrentSession = useCallback(
    async (reason: string): Promise<boolean> => {
      if (sessionEndedRef.current) {
        return true;
      }

      sessionEndedRef.current = true;
      try {
        return await waitForSessionRelease(endSession(reason));
      } catch (error) {
        sessionEndedRef.current = false;
        throw error;
      }
    },
    [endSession]
  );

  const releaseToStudentPortal = useCallback(async () => {
    await endCurrentSession("Invigilator released hosted exam runtime");
    navigate("/student", { replace: true });
  }, [endCurrentSession, navigate]);

  useEffect(() => {
    if (!sessionExamId || !sessionPackageId) {
      return;
    }

    sessionEndedRef.current = false;
    void beginSession({ examId: sessionExamId, packageId: sessionPackageId, mode: "link" });

    return () => {
      void endCurrentSession("Closed hosted exam runtime");
    };
  }, [beginSession, endCurrentSession, sessionExamId, sessionPackageId]);

  useEffect(() => {
    if (!configPackage) {
      return;
    }

    void window.lockedscreenApi.setNavigationGuard({
      allowedDomains: configPackage.browserPolicy.allowedDomains,
      allowedPrefixes: configPackage.browserPolicy.urlRules
        .filter((rule) => rule.kind === "prefix")
        .map((rule) => rule.pattern),
      startUrl: configPackage.browserPolicy.startUrl,
      mode: "link"
    });

    return () => {
      void window.lockedscreenApi.setNavigationGuard(null);
    };
  }, [configPackage?.id, configPackage?.browserPolicy.startUrl, guardDomainsKey, guardPrefixesKey]);

  useEffect(() => {
    return window.lockedscreenApi.onEmbeddedGoogleSignInBlocked(() => {
      setEmbeddedGoogleSignInBlocked(true);
    });
  }, []);

  useEffect(() => {
    if (!exam) {
      return;
    }

    setSession(createSession(exam, launchCandidate));
    setExpired(false);
    setSubmitted(false);
    setSubmitting(false);
    setTurningIn(false);
    setSubmissionResult(null);
    setHostedSubmitDetected(false);
    setEmbeddedGoogleSignInBlocked(false);
  }, [exam, location.search]);

  useEffect(() => {
    if (submitted || expired) {
      return;
    }

    const timer = window.setInterval(() => {
      const webview = webviewRef.current;
      if (!webview) {
        return;
      }

      webview.setZoomFactor?.(hostedZoom);
      const currentUrl = typeof webview.getURL === "function" ? webview.getURL() : "";
      if (currentUrl && isHostedFormCompletionUrl(currentUrl)) {
        setHostedSubmitDetected(true);
      }
    }, 750);

    return () => window.clearInterval(timer);
  }, [expired, hostedZoom, submitted]);

  useEffect(() => {
    if (!session || submitted) {
      return;
    }

    const timer = window.setInterval(() => {
      if (getRemainingSeconds(session) <= 0) {
        window.clearInterval(timer);
        if (configPackage?.sessionPolicy.timeoutAction === "restart" && exam) {
          setSession(createSession(exam, session.candidate));
          returnToStart();
          return;
        }
        setExpired(true);
        void finalize();
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [configPackage?.sessionPolicy.timeoutAction, exam, session, submitted]);

  const finalize = async () => {
    if (submitted || submitting || !exam || !session) {
      return;
    }

    setSubmitting(true);
    const result = await submitExam(exam, session);
    if (!result) {
      setSubmitting(false);
      return;
    }

    setSubmissionResult(result);
    setSubmitted(true);
    setSubmitting(false);
    if (configPackage?.studentLmsBinding.enabled && configPackage) {
      setTurningIn(true);
      const updatedSubmission = await turnInStudentLms({ submissionId: result.id, packageId: configPackage.id });
      if (updatedSubmission) {
        setSubmissionResult(updatedSubmission);
      }
      setTurningIn(false);
      return;
    }

    if (!requiresInvigilatorExitAfterSubmit(configPackage) && configPackage?.sessionPolicy.allowExitAfterSubmit) {
      navigate("/student");
    }
  };

  const returnToStart = () => {
    const startUrl = configPackage?.browserPolicy.startUrl ?? exam?.linkConfig?.url;
    if (!startUrl || !webviewRef.current) {
      return;
    }

    if (configPackage?.browserPolicy.protectedBackToStart && !window.confirm("Return to the configured start page?")) {
      return;
    }

    webviewRef.current.src = startUrl;
    setHostedSubmitDetected(false);
    setEmbeddedGoogleSignInBlocked(false);
  };

  const requestHostedCompletion = () => {
    const confirmed = window.confirm(
      hostedSubmitDetected
        ? "Google Forms appears to have accepted the response. Record the local Lockedscreen submission now?"
        : "Record the local Lockedscreen submission now? Use this only after the online form has been submitted."
    );

    if (confirmed) {
      void finalize();
    }
  };

  if (!exam || !session) {
    return null;
  }

  const webviewHidden = submitted || expired || shellUnlockOpen;

  return (
    <StudentShell
      exam={exam}
      configPackage={configPackage}
      session={session}
      sessionSubmitted={submitted}
      secureMode={snapshot ? isSecureSessionReady(snapshot) : false}
      testingModeName={snapshot ? testingModeLabel(snapshot) : "Testing mode"}
      unlockPin={snapshot?.settings.invigilatorUnlockPin ?? ""}
      onUnlock={releaseToStudentPortal}
      onUnlockDialogChange={setShellUnlockOpen}
      onZoomChange={setHostedZoom}
      scaleContent={false}
    >
      <div className="relative flex h-[calc(100vh-8.5rem)] flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white">
        {submitted ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/90 p-8">
            <div className="w-full max-w-xl space-y-4 text-center text-white">
              <div className="flex flex-col items-center justify-center gap-4">
                <ShieldCheck className="size-12 text-emerald-300" />
                <h2 className="text-3xl font-semibold">Submission recorded</h2>
                <p className="max-w-lg text-sm text-slate-300">
                  Lockedscreen saved the local submission first. Wait for the invigilator before leaving this screen.
                </p>
              </div>
              <StudentLmsTurnInPanel
                configPackage={configPackage}
                submission={submissionResult}
                turningIn={turningIn}
                onTurnIn={() => {
                  if (!submissionResult || !configPackage) {
                    return;
                  }

                  setTurningIn(true);
                  void turnInStudentLms({ submissionId: submissionResult.id, packageId: configPackage.id }).then(
                    (updatedSubmission) => {
                      if (updatedSubmission) {
                        setSubmissionResult(updatedSubmission);
                      }
                      setTurningIn(false);
                    }
                  );
                }}
              />
            </div>
          </div>
        ) : expired ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-slate-950/90 p-8 text-center text-white">
            <Clock3 className="size-12 text-amber-300" />
            <h2 className="text-3xl font-semibold">Time expired</h2>
            <p className="max-w-lg text-sm text-slate-300">
              This linked exam session has ended. Submit the session record and wait for the invigilator.
            </p>
            <Button onClick={() => void finalize()}>End session</Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-900 dark:text-slate-100">
            <span>
              Controlled hosted runtime. Navigation is limited to package-approved domains and URL rules.
            </span>
            {hostedSubmitDetected ? <Badge className="bg-emerald-100 text-emerald-800">Online submission detected</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {configPackage?.browserPolicy.showBackToStartButton ? (
              <Button variant="secondary" onClick={returnToStart}>
                Return to start
              </Button>
            ) : null}
            {configPackage?.sessionPolicy.restartInsteadOfQuit ? (
              <Button variant="secondary" onClick={returnToStart}>
                Restart session
              </Button>
            ) : null}
            <Button onClick={requestHostedCompletion} disabled={submitting || submitted}>
              {submitting ? "Recording..." : hostedSubmitDetected ? "Record detected submission" : "Record online submission"}
            </Button>
          </div>
        </div>

        {embeddedGoogleSignInBlocked ? (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Google sign-in cannot open inside the locked exam browser.</p>
                  <p>
                    This Google Form requires students to sign in. Google blocks account sign-in inside embedded secure
                    browsers, even after app verification. Ask the teacher to turn off the form's sign-in requirement for
                    Lockedscreen link exams, or use an app-based Lockedscreen exam/Classroom assignment instead.
                  </p>
                </div>
              </div>
              <Button variant="secondary" onClick={returnToStart}>
                Return to form
              </Button>
            </div>
          </div>
        ) : null}

        <webview
          ref={webviewRef}
          className={`min-h-0 flex-1 w-full ${webviewHidden ? "hidden" : ""}`}
          src={configPackage?.browserPolicy.startUrl ?? exam.linkConfig?.url}
          partition="persist:lockedscreen-link"
          useragent={hostedExamUserAgent}
          allowpopups={true}
        />
      </div>
    </StudentShell>
  );
};

const ExamZoomControls = ({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) => (
  <div className="flex shrink-0 items-center overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50">
    <button
      type="button"
      className="flex h-10 w-10 items-center justify-center border-r border-slate-200 text-lg font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      onClick={() => onChange(clampExamZoom(zoom - examZoomStep))}
      disabled={zoom <= minExamZoom}
      aria-label="Zoom out"
      title="Zoom out"
    >
      -
    </button>
    <button
      type="button"
      className="h-10 min-w-16 border-r border-slate-200 px-3 text-sm font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      onClick={() => onChange(1)}
      aria-label="Reset zoom"
      title="Reset zoom"
    >
      {Math.round(zoom * 100)}%
    </button>
    <button
      type="button"
      className="flex h-10 w-10 items-center justify-center text-lg font-semibold hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
      onClick={() => onChange(clampExamZoom(zoom + examZoomStep))}
      disabled={zoom >= maxExamZoom}
      aria-label="Zoom in"
      title="Zoom in"
    >
      +
    </button>
  </div>
);

const StudentShell = ({
  exam,
  configPackage,
  session,
  sessionSubmitted,
  secureMode,
  testingModeName,
  unlockPin,
  onUnlock,
  onUnlockDialogChange,
  onZoomChange,
  scaleContent = true,
  children
}: {
  exam: Exam;
  configPackage: ExamConfigPackage | null;
  session: ExamSession;
  sessionSubmitted: boolean;
  secureMode: boolean;
  testingModeName: string;
  unlockPin: string;
  onUnlock: () => void | Promise<void>;
  onUnlockDialogChange?: (open: boolean) => void;
  onZoomChange?: (zoom: number) => void;
  scaleContent?: boolean;
  children: ReactNode;
}) => {
  const { launchApprovedApplication } = useLockedscreenStore();
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const remaining = getRemainingSeconds(session, currentTime);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [pinAttempt, setPinAttempt] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [captureMessage, setCaptureMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [capturePending, setCapturePending] = useState(false);
  const [releasePending, setReleasePending] = useState(false);
  const [contentZoom, setContentZoom] = useState(1);
  const [closeAttemptBlocked, setCloseAttemptBlocked] = useState(false);
  const unlockInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedUnlockPin = unlockPin.trim();
  const normalizedPinAttempt = pinAttempt.trim();
  const invigilatorPinRequired = closeAttemptBlocked || Boolean(configPackage?.quitUnlockPolicy.requireInvigilatorPin);
  const showSchoolBranding = configPackage?.teacherOptions.showSchoolBranding !== false;
  const showCandidateId = configPackage?.teacherOptions.showCandidateId !== false;
  const showTimer = configPackage?.teacherOptions.showTimer !== false;

  useEffect(() => {
    setCurrentTime(new Date());

    if (sessionSubmitted) {
      return;
    }

    const endsAt = new Date(session.endsAt).getTime();
    if (Number.isNaN(endsAt)) {
      return;
    }

    const timer = window.setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      if (now.getTime() >= endsAt) {
        window.clearInterval(timer);
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [session.endsAt, sessionSubmitted]);

  useEffect(() => {
    const unsubscribe = window.lockedscreenApi.onSessionExitBlocked(() => {
      setCloseAttemptBlocked(true);
      setUnlockError("The exam window cannot be closed from the app menu. Enter the invigilator PIN to release this student.");
      setUnlockOpen(true);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        setUnlockOpen(true);
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      const lowerKey = event.key.toLowerCase();
      if (
        event.key === "F5" ||
        (event.ctrlKey && (lowerKey === "r" || lowerKey === "w")) ||
        (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight"))
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  useEffect(() => {
    if (unlockOpen) {
      window.requestAnimationFrame(() => {
        unlockInputRef.current?.focus();
        unlockInputRef.current?.select();
      });
      window.setTimeout(() => unlockInputRef.current?.focus(), 100);
    }

    onUnlockDialogChange?.(unlockOpen);
  }, [onUnlockDialogChange, unlockOpen]);

  useEffect(() => {
    onZoomChange?.(contentZoom);
  }, [contentZoom, onZoomChange]);

  const releaseSession = async () => {
    setReleasePending(true);
    try {
      await onUnlock();
      setUnlockError(null);
      setUnlockOpen(false);
      setPinAttempt("");
      setCloseAttemptBlocked(false);
      setReleasePending(false);
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "Unable to release the session. Try again.");
      setReleasePending(false);
    }
  };

  const attemptUnlock = () => {
    if (releasePending) {
      return;
    }

    if (!invigilatorPinRequired) {
      void releaseSession();
      return;
    }

    if (normalizedPinAttempt === normalizedUnlockPin && normalizedUnlockPin.length > 0) {
      void releaseSession();
      return;
    }

    setUnlockError(normalizedUnlockPin.length === 0 ? "Invigilator PIN is not configured." : "Incorrect invigilator PIN.");
  };

  const captureScreenshot = async () => {
    if (normalizedUnlockPin.length > 0 && normalizedPinAttempt !== normalizedUnlockPin) {
      setUnlockError("Enter the invigilator PIN to save a screenshot.");
      return;
    }

    setCapturePending(true);
    setCaptureMessage(null);
    setUnlockError(null);
    setUnlockOpen(false);

    try {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      const filePath = await window.lockedscreenApi.captureScreenshot();
      if (filePath) {
        setCaptureMessage({
          tone: "success",
          text: `Screenshot saved to ${filePath}`
        });
      }
    } catch {
      setCaptureMessage({
        tone: "error",
        text: "Unable to save a screenshot from the active exam window."
      });
    } finally {
      setCapturePending(false);
      setPinAttempt("");
    }
  };

  return (
    <motion.div {...animation} className="space-y-3">
      <div className="rounded-[28px] border border-white bg-white px-4 py-3 text-slate-950 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50">
        <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                {exam.title || "Exam title"}
              </h1>
              {showSchoolBranding ? (
                <Badge className="bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-100">{exam.branding.schoolName || "School name"}</Badge>
              ) : null}
              <Badge className="bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                {exam.subject || "Subject"}
              </Badge>
              {exam.className ? (
                <Badge className="bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100">{exam.className}</Badge>
              ) : null}
              {exam.form ? (
                <Badge className="bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100">Form {exam.form}</Badge>
              ) : null}
              <Badge className="bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                {exam.mode === "link" ? "Hosted exam" : "Native exam"}
              </Badge>
              {configPackage ? (
                <Badge
                  className={configPackage.securityMode === "full-kiosk" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-950" : "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100"}
                >
                  {configPackage.securityMode === "full-kiosk" ? "Full Kiosk Mode" : "Restricted App Mode"}
                </Badge>
              ) : null}
              {!secureMode ? <Badge className="bg-amber-100 text-amber-900">{testingModeName}</Badge> : null}
            </div>
            {exam.instructions ? (
              <p className="mt-1.5 max-w-5xl text-sm leading-5 text-slate-900 dark:text-slate-100">{exam.instructions}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <div className="rounded-[18px] border border-slate-200 bg-slate-950 px-3 py-2 text-white">
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Student</div>
              <div className="text-sm font-semibold">{session.candidate.name}</div>
              {showCandidateId ? <div className="text-xs text-slate-300">{session.candidate.id}</div> : null}
            </div>
            {showTimer ? (
              <div className="rounded-[18px] border border-teal-200 bg-teal-50 px-3 py-2 text-teal-950 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-50">
                <div className="text-[10px] uppercase tracking-[0.22em] text-teal-800 dark:text-teal-200">Remaining</div>
                <div className="text-xl font-semibold leading-none">{formatTime(remaining)}</div>
              </div>
            ) : null}
            <ExamZoomControls zoom={contentZoom} onChange={setContentZoom} />
            <Button
              variant="secondary"
              className="shrink-0 border-slate-300 bg-white px-3 py-2 text-slate-950 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
              onClick={() => setUnlockOpen(true)}
            >
              <Lock className="size-4" />
              Invigilator unlock
            </Button>
          </div>
        </div>

        <div className="mt-2 grid gap-2">
          {configPackage?.teacherOptions.supportMessage ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              {configPackage.teacherOptions.supportMessage}
            </div>
          ) : null}
          {!secureMode ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {testingModeName}: the app can run and stay full-screen, but the strongest Windows isolation still requires a verified native companion or official kiosk deployment.
            </div>
          ) : null}
        </div>
      </div>

      {captureMessage ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm break-all ${
            captureMessage.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {captureMessage.text}
        </div>
      ) : null}

      {configPackage?.allowedApplications.length ? (
        <Card className="space-y-3 border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Approved Tools</CardTitle>
              <CardDescription>
                These applications are package-approved and launched under kiosk supervision when permitted by the invigilator.
              </CardDescription>
            </div>
            <Badge className="bg-slate-900 text-white">{configPackage.allowedApplications.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {configPackage.allowedApplications.map((entry) => (
              <Button
                key={entry.id}
                variant="secondary"
                className="px-3 py-2"
                onClick={() => void launchApprovedApplication({ packageId: configPackage.id, appId: entry.id })}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </Card>
      ) : null}

      {unlockOpen ? (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-slate-950/80 p-4 pt-20 backdrop-blur-sm">
        <Card className="w-full max-w-3xl border-amber-200 bg-white p-4 text-slate-950 shadow-2xl dark:bg-slate-950 dark:text-slate-50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                  <Lock className="size-5" />
                </div>
                <CardTitle>{sessionSubmitted ? "Invigilator release required" : "Invigilator unlock required"}</CardTitle>
              </div>
              <CardDescription className="max-w-2xl">
                {invigilatorPinRequired
                  ? sessionSubmitted
                    ? "This exam has already been submitted. The session remains locked until the invigilator enters the PIN and releases the student."
                    : "Exit from the active exam session requires the invigilator PIN. The same PIN can be used to save an in-app screenshot without relying on blocked OS shortcuts."
                  : sessionSubmitted
                    ? "This exam has already been submitted. Use the release action below to leave the controlled session."
                    : "Use the release action below to leave the controlled session."}{" "}
                Complete suppression of the Windows key and task switching must still be enforced by a verified native Windows companion or official kiosk deployment.
              </CardDescription>
              {invigilatorPinRequired ? (
                <div className="mt-4 max-w-sm space-y-3">
                  <LabelledField label="Invigilator PIN">
                    <Input
                      ref={unlockInputRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      autoFocus
                      spellCheck={false}
                      disabled={releasePending}
                      value={pinAttempt}
                      onChange={(event) => {
                        setPinAttempt(event.target.value);
                        setUnlockError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          attemptUnlock();
                        }
                      }}
                      className="text-center font-mono text-lg font-semibold tracking-[0.35em]"
                      placeholder="Enter invigilator PIN"
                    />
                  </LabelledField>
                  {releasePending ? <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Releasing the secure session...</div> : null}
                  {unlockError ? <div className="text-sm font-medium text-rose-700 dark:text-rose-300">{unlockError}</div> : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="px-3 py-2" onClick={() => setUnlockOpen(false)} disabled={capturePending || releasePending}>
                Cancel
              </Button>
              <Button variant="secondary" className="px-3 py-2" onClick={() => void captureScreenshot()} disabled={capturePending || releasePending}>
                <Save className="size-4" />
                {capturePending ? "Saving..." : "Save screenshot"}
              </Button>
              <Button className="px-3 py-2" onClick={attemptUnlock} disabled={capturePending || releasePending}>
                {releasePending ? "Releasing..." : sessionSubmitted ? "Release student" : "Unlock session"}
              </Button>
            </div>
          </div>
        </Card>
        </div>
      ) : null}

      <div
        aria-hidden={unlockOpen}
        className={unlockOpen ? "pointer-events-none invisible" : undefined}
        style={scaleContent ? ({ zoom: contentZoom } as CSSProperties) : undefined}
      >
        {children}
      </div>
    </motion.div>
  );
};

const ExamPreviewCard = ({ exam }: { exam: Exam }) => (
  <Card
    className="overflow-hidden"
    style={{
      borderTop: `6px solid ${exam.branding.accentColor}`
    }}
  >
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>Student preview</CardTitle>
          <CardDescription>Shows the calm presentation, exam instructions, and navigation density.</CardDescription>
        </div>
        <Badge>{exam.appearance.theme}</Badge>
      </div>

      <div className="rounded-[28px] bg-slate-950 p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm uppercase tracking-[0.2em] text-slate-400">{exam.branding.schoolName || "School name"}</div>
            <div className="mt-2 text-2xl font-semibold">{exam.title || "Exam title"}</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge className="bg-white/10 text-white">{exam.subject || "Subject"}</Badge>
              <Badge className="bg-white/10 text-white">{exam.className || "Class"}</Badge>
              {exam.form ? <Badge className="bg-white/10 text-white">Form {exam.form}</Badge> : null}
            </div>
          </div>
          <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm">{exam.durationMinutes} mins</div>
        </div>
        <div className="mt-5 rounded-[24px] bg-white px-5 py-4 text-slate-900 dark:bg-slate-800 dark:text-slate-100">
          {exam.mode === "app" ? (
            <>
              <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Question card</div>
              <RichContent
                content={exam.questions[0]?.prompt || "The first question preview appears here."}
                className="text-base leading-7 text-slate-900 dark:text-slate-100"
              />
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Embedded link session</div>
              <div className="text-sm text-slate-900 dark:text-slate-100">{exam.linkConfig?.url || "External exam URL will appear here."}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  </Card>
);

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[24px] bg-slate-50 p-4 dark:bg-slate-800/80">
    <div className="text-xs uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">{label}</div>
    <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{value}</div>
  </div>
);

const LabelledField = ({
  label,
  children,
  labelClassName
}: {
  label: string;
  children: ReactNode;
  labelClassName?: string;
}) => (
  <div className="grid gap-2">
    <span className={`text-sm font-semibold ${labelClassName ?? "text-slate-800 dark:text-slate-100"}`}>{label}</span>
    {children}
  </div>
);

const ToggleField = ({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
    <input
      type="checkbox"
      className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    {label}
  </label>
);

const AdvancedAdminSection = ({
  title,
  unlocked,
  requiresPin,
  pinAttempt,
  unlockError,
  onPinAttemptChange,
  onUnlock,
  onLock,
  children
}: {
  title: string;
  unlocked: boolean;
  requiresPin: boolean;
  pinAttempt: string;
  unlockError: string | null;
  onPinAttemptChange: (value: string) => void;
  onUnlock: () => void;
  onLock: () => void;
  children: ReactNode;
}) => {
  if (!unlocked) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
              <Lock className="size-4" />
              {title}
            </div>
            <CardDescription>
              Admin unlock is required for technical setup, support, and token management.
            </CardDescription>
          </div>
          <Badge className="bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100">Locked</Badge>
        </div>

        {!requiresPin ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            No invigilator PIN is set. Configure one in Kiosk / Lockdown to require a PIN before opening advanced settings.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          {requiresPin ? (
            <LabelledField label="Admin PIN">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pinAttempt}
                onChange={(event) => onPinAttemptChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onUnlock();
                  }
                }}
                placeholder="Enter admin PIN"
              />
            </LabelledField>
          ) : (
            <div className="text-sm text-slate-800 dark:text-slate-100">
              Unlocking will expose admin-only configuration on this screen.
            </div>
          )}
          <Button variant="secondary" onClick={onUnlock}>
            <Lock className="size-4" />
            Unlock
          </Button>
        </div>
        {unlockError ? <div className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-300">{unlockError}</div> : null}
      </div>
    );
  }

  return (
    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 font-semibold text-slate-800 dark:text-slate-100">
        <span>{title}</span>
        <button
          type="button"
          className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          onClick={(event) => {
            event.preventDefault();
            onLock();
          }}
        >
          Lock
        </button>
      </summary>
      {children}
    </details>
  );
};

const PolicySelect = ({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) => (
  <LabelledField label={label}>
    <select className={selectClassName} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </LabelledField>
);

const ValidationCard = ({ item }: { item: ValidationItem }) => (
  <div className={`rounded-2xl border px-4 py-3 text-sm ${statusTone(item.status)}`}>
    <div className="font-semibold">{item.label}</div>
    <div className="mt-1">{item.detail}</div>
    <div className="mt-2 text-xs uppercase tracking-[0.18em] opacity-80">{item.enforcement}</div>
  </div>
);

const StatusChip = ({
  title,
  subtitle,
  status
}: {
  title: string;
  subtitle: string;
  status: VerificationStatus;
}) => (
  <div className={`rounded-2xl border px-4 py-3 text-sm ${statusTone(status)}`}>
    <div className="font-semibold">{title}</div>
    <div className="mt-1">{subtitle}</div>
  </div>
);

export default function App() {
  return (
    <MemoryRouter>
      <AppFrame />
    </MemoryRouter>
  );
}

