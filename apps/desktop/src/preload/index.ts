import { contextBridge, ipcRenderer } from "electron";

import type {
  Candidate,
  AppSettings,
  AppStateSnapshot,
  AppUpdateState,
  Exam,
  ExamConfigPackage,
  ExamSession,
  GoogleClassroomPublishResult,
  ImportPreview,
  LaunchContext,
  LmsConnection,
  LmsCourse,
  LmsCourseWork,
  LmsStudent,
  NavigationGuard,
  ResultDestination,
  SecurityProfile,
  SessionStartRequest,
  StudentLmsTurnInState,
  SubmissionResult
} from "@lockedscreen/shared-types";

export interface LockedscreenApi {
  getSnapshot: () => Promise<AppStateSnapshot>;
  getUpdateState: () => Promise<AppUpdateState>;
  checkForUpdates: () => Promise<AppUpdateState>;
  downloadUpdate: () => Promise<AppUpdateState>;
  installUpdate: () => Promise<void>;
  onUpdateStateChanged: (callback: (state: AppUpdateState) => void) => () => void;
  getLaunchContext: () => Promise<LaunchContext>;
  onLaunchContextChanged: (callback: (context: LaunchContext) => void) => () => void;
  onSessionExitBlocked: (callback: (payload: { reason?: string }) => void) => () => void;
  onHostedGoogleSignInStarted: (callback: (payload: { url?: string }) => void) => () => void;
  onHostedGoogleSignInFinished: (
    callback: (payload: { status: "completed" | "cancelled"; url?: string }) => void
  ) => () => void;
  refreshSecurityOverview: () => Promise<AppStateSnapshot>;
  saveExam: (exam: Exam) => Promise<AppStateSnapshot>;
  deleteExam: (examId: string) => Promise<AppStateSnapshot>;
  hideExamForStudent: (payload: { examId: string; candidateId: string }) => Promise<AppStateSnapshot>;
  saveSettings: (settings: AppSettings) => Promise<AppStateSnapshot>;
  saveSecurityProfile: (profile: SecurityProfile) => Promise<AppStateSnapshot>;
  saveConfigPackage: (configPackage: ExamConfigPackage) => Promise<AppStateSnapshot>;
  saveResultDestination: (destination: ResultDestination) => Promise<AppStateSnapshot>;
  saveResultDestinationTemplate: (destination: ResultDestination) => Promise<AppStateSnapshot>;
  saveLmsConnection: (connection: LmsConnection) => Promise<AppStateSnapshot>;
  deleteLmsConnection: (connectionId: string) => Promise<AppStateSnapshot>;
  connectLmsConnection: (connectionId: string) => Promise<AppStateSnapshot>;
  signOutLmsConnection: (payload: { connectionId: string; revoke?: boolean }) => Promise<AppStateSnapshot>;
  clearLmsConnectionTokens: (connectionId: string) => Promise<AppStateSnapshot>;
  listLmsCourses: (connectionId: string) => Promise<LmsCourse[]>;
  listLmsCourseWork: (payload: { connectionId: string; courseId: string }) => Promise<LmsCourseWork[]>;
  listLmsStudents: (payload: { connectionId: string; courseId: string }) => Promise<LmsStudent[]>;
  deleteResultDestination: (destinationId: string) => Promise<AppStateSnapshot>;
  deleteResultDestinationTemplate: (destinationId: string) => Promise<AppStateSnapshot>;
  deleteConfigPackage: (packageId: string) => Promise<AppStateSnapshot>;
  duplicateConfigPackage: (packageId: string) => Promise<AppStateSnapshot>;
  exportConfigPackage: (payload: { packageId: string }) => Promise<string | null>;
  publishConfigPackageToClassroom: (payload: { packageId: string }) => Promise<{
    snapshot: AppStateSnapshot;
    published: GoogleClassroomPublishResult;
  }>;
  importConfigPackage: (payload?: { filePath?: string; password?: string }) => Promise<AppStateSnapshot | null>;
  importQuestions: () => Promise<ImportPreview | null>;
  exportQuestionTemplate: () => Promise<string | null>;
  exportResultsCsv: (examId?: string) => Promise<string | null>;
  syncSubmissionResults: (submissionId: string) => Promise<AppStateSnapshot>;
  syncPendingResults: () => Promise<AppStateSnapshot>;
  captureScreenshot: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  openGoogleAppsScript: () => Promise<void>;
  beginSession: (request: SessionStartRequest) => Promise<AppStateSnapshot>;
  endSession: (reason?: string) => Promise<AppStateSnapshot>;
  launchApprovedApplication: (payload: { packageId: string; appId: string }) => Promise<AppStateSnapshot>;
  submitExam: (payload: {
    exam: Exam;
    session: ExamSession;
  }) => Promise<{ result: SubmissionResult; snapshot: AppStateSnapshot }>;
  turnInStudentLms: (payload: {
    submissionId: string;
    packageId: string;
  }) => Promise<{ state: StudentLmsTurnInState; submission: SubmissionResult; snapshot: AppStateSnapshot }>;
  setAssistKiosk: (enabled: boolean) => Promise<void>;
  setNavigationGuard: (guard: NavigationGuard | null) => Promise<void>;
  launchAlternateDesktopSession: (payload: { examId: string; candidate: Candidate }) => Promise<boolean>;
}

const api: LockedscreenApi = {
  getSnapshot: () => ipcRenderer.invoke("app:getSnapshot"),
  getUpdateState: () => ipcRenderer.invoke("updates:getState"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => callback(state);
    ipcRenderer.on("app:updateStateChanged", listener);
    return () => ipcRenderer.removeListener("app:updateStateChanged", listener);
  },
  getLaunchContext: () => ipcRenderer.invoke("app:getLaunchContext"),
  onLaunchContextChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, context: LaunchContext) => callback(context);
    ipcRenderer.on("app:launchContextChanged", listener);
    return () => ipcRenderer.removeListener("app:launchContextChanged", listener);
  },
  onSessionExitBlocked: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { reason?: string }) => callback(payload);
    ipcRenderer.on("session:exitBlocked", listener);
    return () => ipcRenderer.removeListener("session:exitBlocked", listener);
  },
  onHostedGoogleSignInStarted: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { url?: string }) => callback(payload);
    ipcRenderer.on("session:hostedGoogleSignInStarted", listener);
    return () => ipcRenderer.removeListener("session:hostedGoogleSignInStarted", listener);
  },
  onHostedGoogleSignInFinished: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { status: "completed" | "cancelled"; url?: string }
    ) => callback(payload);
    ipcRenderer.on("session:hostedGoogleSignInFinished", listener);
    return () => ipcRenderer.removeListener("session:hostedGoogleSignInFinished", listener);
  },
  refreshSecurityOverview: () => ipcRenderer.invoke("security:refreshOverview"),
  saveExam: (exam) => ipcRenderer.invoke("exam:save", exam),
  deleteExam: (examId) => ipcRenderer.invoke("exam:delete", examId),
  hideExamForStudent: (payload) => ipcRenderer.invoke("exam:hideForStudent", payload),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  saveSecurityProfile: (profile) => ipcRenderer.invoke("security:save", profile),
  saveConfigPackage: (configPackage) => ipcRenderer.invoke("configPackage:save", configPackage),
  saveResultDestination: (destination) => ipcRenderer.invoke("resultsDestination:save", destination),
  saveResultDestinationTemplate: (destination) => ipcRenderer.invoke("resultsDestinationTemplate:save", destination),
  saveLmsConnection: (connection) => ipcRenderer.invoke("lmsConnection:save", connection),
  deleteLmsConnection: (connectionId) => ipcRenderer.invoke("lmsConnection:delete", connectionId),
  connectLmsConnection: (connectionId) => ipcRenderer.invoke("lmsConnection:connect", connectionId),
  signOutLmsConnection: (payload) => ipcRenderer.invoke("lmsConnection:signOut", payload),
  clearLmsConnectionTokens: (connectionId) => ipcRenderer.invoke("lmsConnection:clearTokens", connectionId),
  listLmsCourses: (connectionId) => ipcRenderer.invoke("lmsConnection:listCourses", connectionId),
  listLmsCourseWork: (payload) => ipcRenderer.invoke("lmsConnection:listCourseWork", payload),
  listLmsStudents: (payload) => ipcRenderer.invoke("lmsConnection:listStudents", payload),
  deleteResultDestination: (destinationId) => ipcRenderer.invoke("resultsDestination:delete", destinationId),
  deleteResultDestinationTemplate: (destinationId) => ipcRenderer.invoke("resultsDestinationTemplate:delete", destinationId),
  deleteConfigPackage: (packageId) => ipcRenderer.invoke("configPackage:delete", packageId),
  duplicateConfigPackage: (packageId) => ipcRenderer.invoke("configPackage:duplicate", packageId),
  exportConfigPackage: (payload) => ipcRenderer.invoke("configPackage:export", payload),
  publishConfigPackageToClassroom: (payload) => ipcRenderer.invoke("configPackage:publishToClassroom", payload),
  importConfigPackage: (payload) => ipcRenderer.invoke("configPackage:import", payload),
  importQuestions: () => ipcRenderer.invoke("import:questions"),
  exportQuestionTemplate: () => ipcRenderer.invoke("import:exportQuestionTemplate"),
  exportResultsCsv: (examId) => ipcRenderer.invoke("results:exportCsv", examId),
  syncSubmissionResults: (submissionId) => ipcRenderer.invoke("results:syncSubmission", submissionId),
  syncPendingResults: () => ipcRenderer.invoke("results:syncPending"),
  captureScreenshot: () => ipcRenderer.invoke("window:captureScreenshot"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  openGoogleAppsScript: () => ipcRenderer.invoke("help:openGoogleAppsScript"),
  beginSession: (request) => ipcRenderer.invoke("session:begin", request),
  endSession: (reason) => ipcRenderer.invoke("session:end", reason),
  launchApprovedApplication: (payload) => ipcRenderer.invoke("applications:launch", payload),
  submitExam: (payload) => ipcRenderer.invoke("exam:submit", payload),
  turnInStudentLms: (payload) => ipcRenderer.invoke("studentLms:turnIn", payload),
  setAssistKiosk: (enabled) => ipcRenderer.invoke("window:setAssistKiosk", enabled),
  setNavigationGuard: (guard) => ipcRenderer.invoke("window:setNavigationGuard", guard),
  launchAlternateDesktopSession: (payload) => ipcRenderer.invoke("session:launchAlternateDesktop", payload)
};

contextBridge.exposeInMainWorld("lockedscreenApi", api);
