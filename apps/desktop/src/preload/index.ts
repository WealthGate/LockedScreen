import { contextBridge, ipcRenderer } from "electron";

import type {
  Candidate,
  AppSettings,
  AppStateSnapshot,
  Exam,
  ExamConfigPackage,
  ExamSession,
  ImportPreview,
  LaunchContext,
  LmsConnection,
  LmsCourse,
  LmsCourseWork,
  NavigationGuard,
  ResultDestination,
  SecurityProfile,
  SessionStartRequest,
  StudentLmsTurnInState,
  SubmissionResult
} from "@lockedscreen/shared-types";

export interface LockedscreenApi {
  getSnapshot: () => Promise<AppStateSnapshot>;
  getLaunchContext: () => Promise<LaunchContext>;
  onLaunchContextChanged: (callback: (context: LaunchContext) => void) => () => void;
  refreshSecurityOverview: () => Promise<AppStateSnapshot>;
  saveExam: (exam: Exam) => Promise<AppStateSnapshot>;
  deleteExam: (examId: string) => Promise<AppStateSnapshot>;
  hideExamForStudent: (payload: { examId: string; candidateId: string }) => Promise<AppStateSnapshot>;
  saveSettings: (settings: AppSettings) => Promise<AppStateSnapshot>;
  saveSecurityProfile: (profile: SecurityProfile) => Promise<AppStateSnapshot>;
  saveConfigPackage: (configPackage: ExamConfigPackage) => Promise<AppStateSnapshot>;
  saveResultDestination: (destination: ResultDestination) => Promise<AppStateSnapshot>;
  saveLmsConnection: (connection: LmsConnection) => Promise<AppStateSnapshot>;
  deleteLmsConnection: (connectionId: string) => Promise<AppStateSnapshot>;
  connectLmsConnection: (connectionId: string) => Promise<AppStateSnapshot>;
  listLmsCourses: (connectionId: string) => Promise<LmsCourse[]>;
  listLmsCourseWork: (payload: { connectionId: string; courseId: string }) => Promise<LmsCourseWork[]>;
  deleteResultDestination: (destinationId: string) => Promise<AppStateSnapshot>;
  deleteConfigPackage: (packageId: string) => Promise<AppStateSnapshot>;
  duplicateConfigPackage: (packageId: string) => Promise<AppStateSnapshot>;
  exportConfigPackage: (payload: { packageId: string; password: string; passwordHint?: string }) => Promise<string | null>;
  importConfigPackage: (payload: { password: string; passwordHint?: string; filePath?: string }) => Promise<AppStateSnapshot | null>;
  importQuestions: () => Promise<ImportPreview | null>;
  exportResultsCsv: (examId?: string) => Promise<string | null>;
  syncSubmissionResults: (submissionId: string) => Promise<AppStateSnapshot>;
  syncPendingResults: () => Promise<AppStateSnapshot>;
  captureScreenshot: () => Promise<string | null>;
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
  getLaunchContext: () => ipcRenderer.invoke("app:getLaunchContext"),
  onLaunchContextChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, context: LaunchContext) => callback(context);
    ipcRenderer.on("app:launchContextChanged", listener);
    return () => ipcRenderer.removeListener("app:launchContextChanged", listener);
  },
  refreshSecurityOverview: () => ipcRenderer.invoke("security:refreshOverview"),
  saveExam: (exam) => ipcRenderer.invoke("exam:save", exam),
  deleteExam: (examId) => ipcRenderer.invoke("exam:delete", examId),
  hideExamForStudent: (payload) => ipcRenderer.invoke("exam:hideForStudent", payload),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  saveSecurityProfile: (profile) => ipcRenderer.invoke("security:save", profile),
  saveConfigPackage: (configPackage) => ipcRenderer.invoke("configPackage:save", configPackage),
  saveResultDestination: (destination) => ipcRenderer.invoke("resultsDestination:save", destination),
  saveLmsConnection: (connection) => ipcRenderer.invoke("lmsConnection:save", connection),
  deleteLmsConnection: (connectionId) => ipcRenderer.invoke("lmsConnection:delete", connectionId),
  connectLmsConnection: (connectionId) => ipcRenderer.invoke("lmsConnection:connect", connectionId),
  listLmsCourses: (connectionId) => ipcRenderer.invoke("lmsConnection:listCourses", connectionId),
  listLmsCourseWork: (payload) => ipcRenderer.invoke("lmsConnection:listCourseWork", payload),
  deleteResultDestination: (destinationId) => ipcRenderer.invoke("resultsDestination:delete", destinationId),
  deleteConfigPackage: (packageId) => ipcRenderer.invoke("configPackage:delete", packageId),
  duplicateConfigPackage: (packageId) => ipcRenderer.invoke("configPackage:duplicate", packageId),
  exportConfigPackage: (payload) => ipcRenderer.invoke("configPackage:export", payload),
  importConfigPackage: (payload) => ipcRenderer.invoke("configPackage:import", payload),
  importQuestions: () => ipcRenderer.invoke("import:questions"),
  exportResultsCsv: (examId) => ipcRenderer.invoke("results:exportCsv", examId),
  syncSubmissionResults: (submissionId) => ipcRenderer.invoke("results:syncSubmission", submissionId),
  syncPendingResults: () => ipcRenderer.invoke("results:syncPending"),
  captureScreenshot: () => ipcRenderer.invoke("window:captureScreenshot"),
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
