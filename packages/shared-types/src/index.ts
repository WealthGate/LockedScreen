export type ThemePreference = "light" | "dark" | "system";
export type ExamMode = "app" | "link";
export type DensityMode = "comfortable" | "compact";
export type SecurityMode = "restricted-app" | "full-kiosk";
export type EnforcementLevel = "app-enforced" | "native-companion-enforced" | "os-kiosk-enforced" | "advisory";
export type VerificationStatus = "pass" | "warn" | "fail" | "info";
export type BrowserDisplayMode = "minimal" | "focus" | "immersive";
export type ClipboardMode = "allow" | "block-copy" | "block-all";
export type CaptureMode = "allow-in-app-only" | "block-shortcuts" | "advisory-only";
export type PrintMode = "allow" | "block";
export type UrlRuleKind = "domain" | "prefix";
export type UrlRuleRole = "start" | "exam" | "resource" | "help" | "exit";
export type ConfigPackageStatus = "draft" | "active" | "archived";
export type SessionTimeoutAction = "submit" | "restart" | "lock" | "open-exit-link";
export type ProcessViolationAction = "log-only" | "review-recommended";
export type ApprovedAppSupervision = "launch-and-monitor" | "monitor-only";
export type NativeLockdownFeatureLevel = "none" | "partial" | "desktop-lockdown";
export type ResultDestinationType = "google-classroom" | "microsoft-teams" | "google-sheets" | "generic-lms";
export type ResultSyncTrigger = "manual" | "auto-on-submit";
export type ResultSyncAuthMode = "none" | "bearer" | "api-key";
export type ResultSyncStatus = "pending" | "success" | "failed" | "disabled";
export type LmsProviderType = "google-classroom" | "microsoft-365" | "generic-oauth-lms";
export type LmsConnectionStatus = "disconnected" | "connected" | "error";
export type StudentLmsProviderType = "google-classroom" | "microsoft-365";
export type StudentLmsTurnInStatus = "pending" | "success" | "failed" | "skipped";
export type InstalledAppRole = "teacher" | "student";
export type SecurityLogCategory =
  | "package"
  | "integrity"
  | "session"
  | "navigation"
  | "unlock"
  | "process"
  | "environment"
  | "kiosk"
  | "application"
  | "results";
export type SecurityLogSeverity = "info" | "warning" | "error";
export type ProcessDisposition = "allowed" | "review" | "disallowed";

export interface SchoolBranding {
  schoolName: string;
  logoDataUrl?: string;
  accentColor: string;
}

export interface ExamAppearance {
  theme: ThemePreference;
  headerLayout: "centered" | "split";
  fontScale: number;
  density: DensityMode;
}

export interface MultipleChoiceOption {
  id: string;
  label: string;
  content: string;
}

export interface MultipleChoiceQuestion {
  id: string;
  type: "multiple-choice";
  prompt: string;
  explanation?: string;
  points: number;
  options: MultipleChoiceOption[];
  correctOptionId: string;
  flagged?: boolean;
}

export type Question = MultipleChoiceQuestion;

export interface LinkExamConfig {
  url: string;
  allowedDomains: string[];
}

export interface Exam {
  id: string;
  mode: ExamMode;
  title: string;
  subject: string;
  className: string;
  form: string;
  instructions: string;
  durationMinutes: number;
  branding: SchoolBranding;
  appearance: ExamAppearance;
  questions: Question[];
  linkConfig?: LinkExamConfig;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: string;
  name: string;
  className?: string;
}

export interface ExamResponse {
  questionId: string;
  selectedOptionId?: string;
  flagged: boolean;
}

export interface ExamSession {
  examId: string;
  candidate: Candidate;
  startedAt: string;
  endsAt: string;
  responses: ExamResponse[];
  mode: ExamMode;
}

export interface SubmissionResult {
  id: string;
  examId: string;
  examTitle: string;
  candidateName: string;
  candidateId: string;
  candidateClassName?: string;
  submittedAt: string;
  score: number;
  totalPoints: number;
  percentage: number;
  responses: ExamResponse[];
  syncStates: SubmissionSyncState[];
  studentLmsTurnIn?: StudentLmsTurnInState;
}

export interface ResultDestination {
  id: string;
  label: string;
  type: ResultDestinationType;
  enabled: boolean;
  trigger: ResultSyncTrigger;
  endpointUrl: string;
  authMode: ResultSyncAuthMode;
  authToken?: string;
  apiKeyHeader?: string;
  className?: string;
  courseId?: string;
  sheetName?: string;
  examIds: string[];
  includeResponses: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LmsConnection {
  id: string;
  label: string;
  provider: LmsProviderType;
  status: LmsConnectionStatus;
  clientId: string;
  tenantId?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scope: string;
  accountEmail?: string;
  accountName?: string;
  lastConnectedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LmsCourse {
  id: string;
  name: string;
  section?: string;
  alternateLink?: string;
}

export interface LmsCourseWork {
  id: string;
  courseId: string;
  title: string;
  alternateLink?: string;
  dueAt?: string;
  state?: string;
}

export interface LmsStudent {
  id: string;
  name: string;
  email?: string;
}

export interface StudentLmsBinding {
  enabled: boolean;
  provider: StudentLmsProviderType;
  connectionId?: string;
  clientId: string;
  tenantId?: string;
  scope: string;
  courseId: string;
  courseLabel?: string;
  assignmentId: string;
  assignmentLabel?: string;
}

export interface StudentLmsTurnInState {
  provider: StudentLmsProviderType;
  status: StudentLmsTurnInStatus;
  lastAttemptAt?: string;
  submittedAt?: string;
  externalReference?: string;
  lastError?: string;
}

export interface SubmissionSyncState {
  destinationId: string;
  destinationLabel: string;
  destinationType: ResultDestinationType;
  status: ResultSyncStatus;
  lastAttemptAt?: string;
  lastError?: string;
  externalReference?: string;
  httpStatus?: number;
}

export interface PackageUrlRule {
  id: string;
  label: string;
  pattern: string;
  kind: UrlRuleKind;
  role: UrlRuleRole;
  allowSubdomains: boolean;
}

export interface AllowedApplicationPolicy {
  id: string;
  label: string;
  executablePath: string;
  args: string[];
  notes?: string;
  supervision: ApprovedAppSupervision;
}

export interface BrowserRuntimePolicy {
  displayMode: BrowserDisplayMode;
  showReloadButton: boolean;
  showBackToStartButton: boolean;
  protectedBackToStart: boolean;
  showToolbarHints: boolean;
  allowContextMenu: boolean;
  restrictNavigationChrome: boolean;
  preserveQueryParameters: boolean;
  startUrl?: string;
  allowedDomains: string[];
  urlRules: PackageUrlRule[];
}

export interface SessionHandlingPolicy {
  clearSessionOnStart: boolean;
  clearSessionOnEnd: boolean;
  restartInsteadOfQuit: boolean;
  askBeforeQuit: boolean;
  allowExitAfterSubmit: boolean;
  exitUrl?: string;
  timeoutAction: SessionTimeoutAction;
}

export interface BooleanPolicyCheck {
  enabled: boolean;
  required: boolean;
  enforcement: EnforcementLevel;
}

export interface EnvironmentPolicy {
  virtualMachine: BooleanPolicyCheck;
  multipleDisplays: BooleanPolicyCheck;
  remoteSession: BooleanPolicyCheck;
  screenSharing: BooleanPolicyCheck;
  screenCapture: BooleanPolicyCheck;
  printing: BooleanPolicyCheck;
  clipboard: BooleanPolicyCheck;
  sleepIdle: BooleanPolicyCheck;
}

export interface ProcessPolicy {
  enabled: boolean;
  pollIntervalSeconds: number;
  allowedProcessNames: string[];
  disallowedProcessNames: string[];
  violationAction: ProcessViolationAction;
}

export interface KeyRestrictionPolicy {
  enforcement: EnforcementLevel;
  metadata: string;
  blockedShortcuts: string[];
}

export interface TeacherOptions {
  showSchoolBranding: boolean;
  showCandidateId: boolean;
  showTimer: boolean;
  supportMessage?: string;
}

export interface StudentAccessPolicy {
  assignedClassNames: string[];
  assignedCandidateIds: string[];
  availableFrom?: string;
  availableUntil?: string;
  allowStudentDeletionAfterCompletion: boolean;
}

export interface QuitUnlockPolicy {
  requireInvigilatorPin: boolean;
  allowRestartSession: boolean;
  askBeforeQuit: boolean;
}

export interface ConfigPackageIntegrity {
  algorithm: "sha256";
  checksum: string;
  lastValidatedAt?: string;
  lastValidationStatus?: VerificationStatus;
}

export interface ExamConfigPackage {
  id: string;
  examId: string;
  label: string;
  description: string;
  status: ConfigPackageStatus;
  packageVersion: number;
  sourceMode: ExamMode;
  securityMode: SecurityMode;
  browserPolicy: BrowserRuntimePolicy;
  sessionPolicy: SessionHandlingPolicy;
  allowedApplications: AllowedApplicationPolicy[];
  processPolicy: ProcessPolicy;
  environmentPolicy: EnvironmentPolicy;
  clipboardPolicy: {
    mode: ClipboardMode;
    enforcement: EnforcementLevel;
  };
  capturePolicy: {
    mode: CaptureMode;
    enforcement: EnforcementLevel;
  };
  printPolicy: {
    mode: PrintMode;
    enforcement: EnforcementLevel;
  };
  keyRestrictionPolicy: KeyRestrictionPolicy;
  teacherOptions: TeacherOptions;
  studentAccessPolicy: StudentAccessPolicy;
  quitUnlockPolicy: QuitUnlockPolicy;
  branding: SchoolBranding;
  studentLmsBinding: StudentLmsBinding;
  createdAt: string;
  updatedAt: string;
  passwordHint?: string;
  integrity: ConfigPackageIntegrity;
}

export interface AppSettings {
  invigilatorUnlockPin: string;
  defaultTheme: ThemePreference;
  allowElectronKioskAssist: boolean;
  allowNonKioskTestingMode: boolean;
  approvedDomains: string[];
}

export interface SecurityProfile {
  kioskConfigured: boolean;
  kioskMode: "assigned-access" | "shell-launcher" | "windows-native-companion" | "hybrid" | "not-configured";
  dedicatedExamAccount: boolean;
  nativeCompanionVerified: boolean;
  lastVerifiedAt?: string;
}

export interface NativeLockdownEnvironment {
  supported: boolean;
  helperPresent: boolean;
  helperPath?: string;
  servicePresent: boolean;
  serviceRunning: boolean;
  lockdownCapable: boolean;
  featureLevel: NativeLockdownFeatureLevel;
  detail: string;
}

export interface RuntimeEnvironment {
  platform: "windows" | "macos" | "linux" | "unknown";
  windowsEdition?: "home" | "pro" | "enterprise" | "education" | "iot-enterprise" | "unknown";
  supportsAssignedAccess: boolean;
  supportsShellLauncher: boolean;
  supportsWindowsNativeLockdown: boolean;
  nativeLockdown: NativeLockdownEnvironment;
  canOnlyUseTestingMode: boolean;
}

export interface SecurityLogEntry {
  id: string;
  timestamp: string;
  category: SecurityLogCategory;
  severity: SecurityLogSeverity;
  message: string;
  details?: string;
}

export interface EnvironmentCheckResult {
  id: string;
  label: string;
  status: VerificationStatus;
  enforcement: EnforcementLevel;
  detail: string;
  observedValue?: string;
}

export interface ProcessObservation {
  pid: number;
  name: string;
  disposition: ProcessDisposition;
}

export interface ProcessMonitorSummary {
  monitored: boolean;
  allowed: number;
  review: number;
  disallowed: number;
  lastScanAt?: string;
  observations: ProcessObservation[];
}

export interface ValidationItem {
  id: string;
  label: string;
  status: VerificationStatus;
  enforcement: EnforcementLevel;
  detail: string;
}

export interface PackageIntegritySummary {
  packageId: string;
  examId: string;
  label: string;
  securityMode: SecurityMode;
  status: VerificationStatus;
  detail: string;
  checksum: string;
  lastValidatedAt?: string;
}

export interface SecurityOverview {
  deploymentMode: SecurityMode;
  deploymentRecommendation: string;
  packageSummaries: PackageIntegritySummary[];
  environmentChecks: EnvironmentCheckResult[];
  validationItems: ValidationItem[];
  processSummary: ProcessMonitorSummary;
}

export interface AppStateSnapshot {
  exams: Exam[];
  configPackages: ExamConfigPackage[];
  submissions: SubmissionResult[];
  studentExamStates: StudentExamState[];
  resultDestinations: ResultDestination[];
  lmsConnections: LmsConnection[];
  settings: AppSettings;
  securityProfile: SecurityProfile;
  securityLogs: SecurityLogEntry[];
  runtime?: RuntimeEnvironment;
  securityOverview?: SecurityOverview;
}

export interface StudentExamState {
  examId: string;
  candidateId: string;
  hiddenAt: string;
}

export interface ParseIssue {
  line?: number;
  message: string;
  severity: "error" | "warning";
}

export interface ImportedQuestionDraft {
  id: string;
  prompt: string;
  points: number;
  options: MultipleChoiceOption[];
  selectedCorrectOptionId?: string;
  detectedAnswerLabel?: string;
}

export interface ImportedExamMetadata {
  title: string;
  subject: string;
  className: string;
  form: string;
  teacherName: string;
  schoolName: string;
  instructions: string;
  durationText: string;
  durationMinutes?: number;
}

export type ImportExtractionMethod = "text" | "docx" | "doc" | "pdf-text" | "pdf-ocr" | "image-ocr";

export interface ImportExtractionInfo {
  method: ImportExtractionMethod;
  usedOcr: boolean;
  pageLimitReached?: boolean;
  maxPages?: number;
}

export interface ImportPreview {
  sourceFileName: string;
  metadata: ImportedExamMetadata;
  questions: ImportedQuestionDraft[];
  issues: ParseIssue[];
  sourceText: string;
  extraction?: ImportExtractionInfo;
}

export interface NavigationGuard {
  allowedDomains: string[];
  allowedPrefixes?: string[];
  startUrl?: string;
  mode: ExamMode;
}

export interface ProtectedConfigPackageFile {
  format: "lockedscreen-config-package";
  version: 1 | 2;
  packageId: string;
  label: string;
  examTitle?: string;
  checksum: string;
  passwordHint?: string;
  algorithm: "aes-256-gcm";
  digest: "sha256";
  salt: string;
  iv: string;
  authTag: string;
  payload: string;
  exportedAt: string;
}

export interface SessionStartRequest {
  examId: string;
  packageId: string;
  mode: ExamMode;
}

export interface ProtectedPackageLaunchInfo {
  filePath: string;
  label: string;
  examTitle?: string;
  passwordHint?: string;
}

export interface LaunchContext {
  route: string | null;
  nativeHosted: boolean;
  packageImport: ProtectedPackageLaunchInfo | null;
  installedRole: InstalledAppRole;
}
