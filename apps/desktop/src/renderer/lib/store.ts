import { create } from "zustand";

import type {
  Candidate,
  AppSettings,
  AppStateSnapshot,
  Exam,
  ExamConfigPackage,
  ExamSession,
  ImportPreview,
  LmsConnection,
  LmsCourse,
  LmsCourseWork,
  LmsStudent,
  ResultDestination,
  SecurityProfile,
  SubmissionResult
} from "@lockedscreen/shared-types";

interface LockedscreenStore {
  snapshot: AppStateSnapshot | null;
  loading: boolean;
  error: string | null;
  activeImport: ImportPreview | null;
  load: () => Promise<AppStateSnapshot | null>;
  refreshSecurityOverview: () => Promise<AppStateSnapshot | null>;
  saveExam: (exam: Exam) => Promise<AppStateSnapshot | null>;
  deleteExam: (examId: string) => Promise<AppStateSnapshot | null>;
  hideExamForStudent: (payload: { examId: string; candidateId: string }) => Promise<AppStateSnapshot | null>;
  saveSettings: (settings: AppSettings) => Promise<AppStateSnapshot | null>;
  saveSecurityProfile: (profile: SecurityProfile) => Promise<AppStateSnapshot | null>;
  saveConfigPackage: (configPackage: ExamConfigPackage) => Promise<AppStateSnapshot | null>;
  saveResultDestination: (destination: ResultDestination) => Promise<AppStateSnapshot | null>;
  saveLmsConnection: (connection: LmsConnection) => Promise<AppStateSnapshot | null>;
  deleteLmsConnection: (connectionId: string) => Promise<AppStateSnapshot | null>;
  connectLmsConnection: (connectionId: string) => Promise<AppStateSnapshot | null>;
  listLmsCourses: (connectionId: string) => Promise<LmsCourse[]>;
  listLmsCourseWork: (payload: { connectionId: string; courseId: string }) => Promise<LmsCourseWork[]>;
  listLmsStudents: (payload: { connectionId: string; courseId: string }) => Promise<LmsStudent[]>;
  deleteResultDestination: (destinationId: string) => Promise<AppStateSnapshot | null>;
  deleteConfigPackage: (packageId: string) => Promise<AppStateSnapshot | null>;
  duplicateConfigPackage: (packageId: string) => Promise<AppStateSnapshot | null>;
  exportConfigPackage: (payload: { packageId: string }) => Promise<string | null>;
  importConfigPackage: (payload?: { filePath?: string; password?: string }) => Promise<AppStateSnapshot | null>;
  importQuestions: () => Promise<ImportPreview | null>;
  exportQuestionTemplate: () => Promise<string | null>;
  exportResultsCsv: (examId?: string) => Promise<string | null>;
  syncSubmissionResults: (submissionId: string) => Promise<AppStateSnapshot | null>;
  syncPendingResults: () => Promise<AppStateSnapshot | null>;
  beginSession: (payload: { examId: string; packageId: string; mode: Exam["mode"] }) => Promise<AppStateSnapshot | null>;
  launchAlternateDesktopSession: (payload: { examId: string; candidate: Candidate }) => Promise<boolean>;
  endSession: (reason?: string) => Promise<AppStateSnapshot | null>;
  launchApprovedApplication: (payload: { packageId: string; appId: string }) => Promise<AppStateSnapshot | null>;
  submitExam: (exam: Exam, session: ExamSession) => Promise<SubmissionResult | null>;
  turnInStudentLms: (payload: { submissionId: string; packageId: string }) => Promise<SubmissionResult | null>;
}

const withGuard = async <T>(operation: () => Promise<T>, onError: (message: string) => void): Promise<T | null> => {
  try {
    return await operation();
  } catch (error) {
    onError(error instanceof Error ? error.message : "Unexpected error");
    return null;
  }
};

export const useLockedscreenStore = create<LockedscreenStore>((set) => ({
  snapshot: null,
  loading: false,
  error: null,
  activeImport: null,
  load: async () => {
    set({ loading: true, error: null });
    const snapshot = await withGuard(() => window.lockedscreenApi.getSnapshot(), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, loading: false, error: null });
    } else {
      set({ snapshot: null, loading: false });
    }
    return snapshot;
  },
  refreshSecurityOverview: async () => {
    const snapshot = await withGuard(() => window.lockedscreenApi.refreshSecurityOverview(), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  saveExam: async (exam) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.saveExam(exam), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  deleteExam: async (examId) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.deleteExam(examId), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  hideExamForStudent: async (payload) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.hideExamForStudent(payload), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  saveSettings: async (settings) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.saveSettings(settings), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  saveSecurityProfile: async (profile) => {
    const snapshot = await withGuard(
      () => window.lockedscreenApi.saveSecurityProfile(profile),
      (error) => set({ error })
    );
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  saveConfigPackage: async (configPackage) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.saveConfigPackage(configPackage), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  saveResultDestination: async (destination) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.saveResultDestination(destination), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  saveLmsConnection: async (connection) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.saveLmsConnection(connection), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  deleteLmsConnection: async (connectionId) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.deleteLmsConnection(connectionId), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  connectLmsConnection: async (connectionId) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.connectLmsConnection(connectionId), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  listLmsCourses: async (connectionId) => {
    try {
      return await window.lockedscreenApi.listLmsCourses(connectionId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unexpected error" });
      return [];
    }
  },
  listLmsCourseWork: async (payload) => {
    try {
      return await window.lockedscreenApi.listLmsCourseWork(payload);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unexpected error" });
      return [];
    }
  },
  listLmsStudents: async (payload) => {
    try {
      return await window.lockedscreenApi.listLmsStudents(payload);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unexpected error" });
      return [];
    }
  },
  deleteResultDestination: async (destinationId) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.deleteResultDestination(destinationId), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  deleteConfigPackage: async (packageId) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.deleteConfigPackage(packageId), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  duplicateConfigPackage: async (packageId) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.duplicateConfigPackage(packageId), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  exportConfigPackage: async (payload) =>
    withGuard(() => window.lockedscreenApi.exportConfigPackage(payload), (error) => set({ error })),
  importConfigPackage: async (payload) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.importConfigPackage(payload), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  importQuestions: async () => {
    const preview = await withGuard(() => window.lockedscreenApi.importQuestions(), (error) => set({ error }));
    set({ activeImport: preview ?? null });
    return preview;
  },
  exportQuestionTemplate: async () =>
    withGuard(() => window.lockedscreenApi.exportQuestionTemplate(), (error) => set({ error })),
  exportResultsCsv: async (examId) =>
    withGuard(() => window.lockedscreenApi.exportResultsCsv(examId), (error) => set({ error })),
  syncSubmissionResults: async (submissionId) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.syncSubmissionResults(submissionId), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  syncPendingResults: async () => {
    const snapshot = await withGuard(() => window.lockedscreenApi.syncPendingResults(), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  beginSession: async (payload) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.beginSession(payload), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  launchAlternateDesktopSession: async (payload) => {
    try {
      return await window.lockedscreenApi.launchAlternateDesktopSession(payload);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Unexpected error" });
      throw error;
    }
  },
  endSession: async (reason) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.endSession(reason), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  launchApprovedApplication: async (payload) => {
    const snapshot = await withGuard(() => window.lockedscreenApi.launchApprovedApplication(payload), (error) => set({ error }));
    if (snapshot) {
      set({ snapshot, error: null });
    }
    return snapshot;
  },
  submitExam: async (exam, session) => {
    const response = await withGuard(() => window.lockedscreenApi.submitExam({ exam, session }), (error) =>
      set({ error })
    );
    if (response) {
      set({ snapshot: response.snapshot });
      return response.result;
    }
    return null;
  },
  turnInStudentLms: async (payload) => {
    const response = await withGuard(() => window.lockedscreenApi.turnInStudentLms(payload), (error) => set({ error }));
    if (response) {
      set({ snapshot: response.snapshot });
      return response.submission;
    }
    return null;
  }
}));
