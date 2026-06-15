import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { URL, URLSearchParams } from "node:url";

import { BrowserWindow } from "electron";

import type {
  Exam,
  ExamResponse,
  ExamConfigPackage,
  StudentLmsBinding,
  StudentLmsProviderType,
  StudentLmsTurnInState,
  SubmissionResult
} from "@lockedscreen/shared-types";
import { recoverGoogleAssignmentBinding } from "./student-lms-binding";

interface StudentOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  profileEmail?: string;
}

interface SubmissionArtifact {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

interface GoogleUploadedFile {
  id: string;
  name: string;
  webViewLink?: string;
}

interface MicrosoftUploadedFile {
  driveId: string;
  itemId: string;
  webUrl?: string;
}

interface TurnInOptions {
  teacherAccessToken?: string;
}

interface StudentProfile {
  email?: string;
}

const toBase64Url = (input: Buffer): string =>
  input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const createPkce = () => {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const defaultStudentScope = (provider: StudentLmsProviderType): string =>
  provider === "google-classroom"
    ? [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/classroom.coursework.me",
        "https://www.googleapis.com/auth/drive.file"
      ].join(" ")
    : ["offline_access", "openid", "profile", "User.Read", "EduAssignments.ReadWrite", "Files.ReadWrite"].join(" ");

const studentOAuthScope = (binding: StudentLmsBinding): string =>
  binding.provider === "google-classroom"
    ? defaultStudentScope("google-classroom")
    : binding.scope.trim() || defaultStudentScope(binding.provider);

const providerAuthorizeUrl = (binding: StudentLmsBinding): string =>
  binding.provider === "google-classroom"
    ? "https://accounts.google.com/o/oauth2/v2/auth"
    : `https://login.microsoftonline.com/${binding.tenantId?.trim() || "common"}/oauth2/v2.0/authorize`;

const providerTokenUrl = (binding: StudentLmsBinding): string =>
  binding.provider === "google-classroom"
    ? "https://oauth2.googleapis.com/token"
    : `https://login.microsoftonline.com/${binding.tenantId?.trim() || "common"}/oauth2/v2.0/token`;

const friendlyStudentOAuthError = (provider: StudentLmsProviderType, error: string, description?: string): Error => {
  const detail = [error, description].filter(Boolean).join(" ").toLowerCase();

  if (provider === "google-classroom") {
    if (detail.includes("admin_policy_enforced") || detail.includes("access blocked")) {
      return new Error(
        "Student Google sign-in was blocked by the school Google Workspace policy. The local exam submission is saved. Ask the Google administrator to allow the Lockedscreen OAuth app for students, then retry Classroom turn-in."
      );
    }

    if (
      detail.includes("test user") ||
      detail.includes("testing") ||
      detail.includes("not completed") ||
      detail.includes("not verified")
    ) {
      return new Error(
        "The Google OAuth app is still in testing or unverified for this student account. The local exam submission is saved. Add the student account as an allowed test user or publish/verify the Google app."
      );
    }
  }

  if (error === "access_denied" || detail.includes("access_denied")) {
    return new Error("Student sign-in was cancelled or the requested LMS permission was not approved.");
  }

  if (error === "invalid_scope" || detail.includes("invalid_scope")) {
    return new Error("The student LMS permissions in this package are not valid. Re-save and re-export the package, then retry turn-in.");
  }

  return new Error(description || error || "Student LMS sign-in failed.");
};

const normalizeEmailDomain = (value: string): string =>
  value.trim().replace(/^@+/, "").toLowerCase();

const normalizeEmailDomains = (domains: string[] | undefined): string[] =>
  Array.from(new Set((domains ?? []).map(normalizeEmailDomain).filter(Boolean)));

const domainFromEmail = (email?: string): string | null => {
  const trimmed = email?.trim().toLowerCase();
  const atIndex = trimmed?.lastIndexOf("@") ?? -1;
  return trimmed && atIndex >= 0 ? normalizeEmailDomain(trimmed.slice(atIndex + 1)) : null;
};

const assertStudentEmailDomainAllowed = (configPackage: ExamConfigPackage, email?: string): void => {
  const allowedDomains = normalizeEmailDomains(configPackage.studentAccessPolicy.allowedEmailDomains);
  if (allowedDomains.length === 0) {
    return;
  }

  const actualDomain = domainFromEmail(email);
  if (!actualDomain) {
    throw new Error(
      `Lockedscreen could not confirm the signed-in student email domain. Use a school account ending in ${allowedDomains.join(", ")}.`
    );
  }

  if (!allowedDomains.includes(actualDomain)) {
    throw new Error(
      `This exam only accepts student accounts from ${allowedDomains.join(", ")}. Sign out and use the correct school account.`
    );
  }
};

const sanitizeFileName = (value: string): string =>
  value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "lockedscreen-submission";

const buildSubmissionArtifact = (exam: Exam, submission: SubmissionResult): SubmissionArtifact => {
  const responseLookup = new Map(exam.questions.map((question) => [question.id, question]));
  const responses = submission.responses.map((response: ExamResponse) => {
    const question = responseLookup.get(response.questionId);
    const selectedOption = question?.options.find((option) => option.id === response.selectedOptionId);
    return {
      questionId: response.questionId,
      prompt: question?.prompt ?? "",
      selectedOptionId: response.selectedOptionId ?? null,
      selectedOptionLabel: selectedOption?.label ?? null,
      selectedOptionContent: selectedOption?.content ?? null,
      flagged: response.flagged
    };
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    exam: {
      id: exam.id,
      title: exam.title,
      subject: exam.subject,
      className: exam.className,
      form: exam.form
    },
    candidate: {
      id: submission.candidateId,
      name: submission.candidateName
    },
    submission: {
      id: submission.id,
      submittedAt: submission.submittedAt,
      score: submission.score,
      totalPoints: submission.totalPoints,
      percentage: submission.percentage
    },
    responses
  };

  const stem = sanitizeFileName(`${exam.title || "exam"}-${submission.candidateName || submission.candidateId}`);
  return {
    fileName: `${stem}.json`,
    mimeType: "application/json",
    content: Buffer.from(JSON.stringify(payload, null, 2), "utf-8")
  };
};

const fetchStudentProfile = async (binding: StudentLmsBinding, accessToken: string): Promise<StudentProfile> => {
  const url =
    binding.provider === "google-classroom"
      ? "https://www.googleapis.com/oauth2/v3/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {};
  }

  return {
    email:
      typeof payload.email === "string"
        ? payload.email
        : typeof payload.userPrincipalName === "string"
          ? payload.userPrincipalName
          : typeof payload.mail === "string"
            ? payload.mail
            : undefined
  };
};

const createAuthorizationListener = async (
  provider: StudentLmsProviderType,
  expectedState: string
): Promise<{ redirectUri: string; waitForCode: () => Promise<string> }> =>
  new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description") ?? undefined;
      const state = requestUrl.searchParams.get("state");

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        error
          ? "<html><body><h2>Sign-in failed</h2><p>You can close this window and return to Lockedscreen.</p></body></html>"
          : "<html><body><h2>Sign-in complete</h2><p>You can close this window and return to Lockedscreen.</p></body></html>"
      );

      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      server.close();

      if (error) {
        pendingReject?.(friendlyStudentOAuthError(provider, error, errorDescription));
        return;
      }

      if (state !== expectedState) {
        pendingReject?.(new Error("OAuth callback state validation failed."));
        return;
      }

      if (!code) {
        pendingReject?.(new Error("OAuth callback did not include an authorization code."));
        return;
      }

      pendingResolve?.(code);
    });

    let pendingResolve: ((code: string) => void) | null = null;
    let pendingReject: ((error: Error) => void) | null = null;
    let timeout: NodeJS.Timeout | null = null;

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to start local OAuth callback server."));
        return;
      }

      resolve({
        redirectUri: `http://127.0.0.1:${address.port}/callback`,
        waitForCode: () =>
          new Promise<string>((resolveCode, rejectCode) => {
            pendingResolve = resolveCode;
            pendingReject = rejectCode;
            timeout = setTimeout(() => {
              server.close();
              rejectCode(new Error("Student sign-in timed out."));
            }, 180000);
          })
      });
    });
  });

const openOAuthWindow = async (parentWindow: BrowserWindow | null, url: string): Promise<BrowserWindow> => {
  const authWindow = new BrowserWindow({
    parent: parentWindow ?? undefined,
    modal: Boolean(parentWindow),
    width: 560,
    height: 760,
    minWidth: 480,
    minHeight: 640,
    autoHideMenuBar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    show: false,
    title: "Lockedscreen LMS sign-in",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `lockedscreen-student-oauth-${randomBytes(8).toString("hex")}`
    }
  });

  authWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    void authWindow.loadURL(targetUrl);
    return { action: "deny" };
  });
  authWindow.once("ready-to-show", () => authWindow.show());
  await authWindow.loadURL(url);
  return authWindow;
};

const exchangeAuthorizationCode = async (
  binding: StudentLmsBinding,
  code: string,
  redirectUri: string,
  verifier: string
): Promise<StudentOAuthTokens> => {
  const body = new URLSearchParams({
    client_id: binding.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: studentOAuthScope(binding)
  });
  if (binding.clientSecret?.trim()) {
    body.set("client_secret", binding.clientSecret.trim());
  }

  const response = await fetch(providerTokenUrl(binding), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw friendlyStudentOAuthError(
      binding.provider,
      typeof payload.error === "string" ? payload.error : "token_exchange_failed",
      typeof payload.error_description === "string" ? payload.error_description : undefined
    );
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in ?? 0);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
  };
};

const signInStudent = async (
  binding: StudentLmsBinding,
  parentWindow: BrowserWindow | null,
  allowedEmailDomains: string[]
): Promise<StudentOAuthTokens> => {
  if (!binding.clientId.trim()) {
    throw new Error("This package is missing the LMS OAuth client ID.");
  }

  const state = randomBytes(16).toString("hex");
  const pkce = createPkce();
  const authorization = await createAuthorizationListener(binding.provider, state);
  const params = new URLSearchParams({
    client_id: binding.clientId,
    response_type: "code",
    redirect_uri: authorization.redirectUri,
    scope: studentOAuthScope(binding),
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256"
  });

  if (binding.provider === "google-classroom") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    const hostedDomainHint = allowedEmailDomains[0];
    if (allowedEmailDomains.length === 1 && hostedDomainHint) {
      params.set("hd", hostedDomainHint);
    }
  }

  const authUrl = new URL(providerAuthorizeUrl(binding));
  params.forEach((value, key) => authUrl.searchParams.set(key, value));
  const authWindow = await openOAuthWindow(parentWindow, authUrl.toString());

  try {
    const codePromise = authorization.waitForCode();
    const closedPromise = new Promise<never>((_, reject) => {
      authWindow.once("closed", () => reject(new Error("Student sign-in was closed before it completed.")));
    });
    const code = await Promise.race([codePromise, closedPromise]);
    const tokens = await exchangeAuthorizationCode(binding, code, authorization.redirectUri, pkce.verifier);
    const profile = await fetchStudentProfile(binding, tokens.accessToken);
    return {
      ...tokens,
      profileEmail: profile.email
    };
  } finally {
    if (!authWindow.isDestroyed()) {
      authWindow.close();
    }
  }
};

const fetchJson = async <T>(url: string, init: RequestInit, fallbackMessage: string): Promise<T> => {
  const response = await fetch(url, init);
  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as Record<string, unknown>)
    : { message: await response.text() };
  const errorPayload =
    typeof payload.error === "object" && payload.error !== null ? (payload.error as Record<string, unknown>) : undefined;

  if (!response.ok) {
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof errorPayload?.message === "string"
          ? errorPayload.message
          : typeof payload.message === "string"
            ? payload.message
            : fallbackMessage
    );
  }

  return payload as T;
};

const uploadGoogleArtifact = async (accessToken: string, artifact: SubmissionArtifact): Promise<GoogleUploadedFile> => {
  const boundary = `lockedscreen-${randomBytes(12).toString("hex")}`;
  const delimiter = `--${boundary}`;
  const metadata = Buffer.from(
    `${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
      name: artifact.fileName,
      mimeType: artifact.mimeType
    })}\r\n${delimiter}\r\nContent-Type: ${artifact.mimeType}\r\n\r\n`,
    "utf-8"
  );
  const footer = Buffer.from(`\r\n${delimiter}--`, "utf-8");

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: new Uint8Array(Buffer.concat([metadata, artifact.content, footer]))
    }
  );

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.id !== "string") {
    throw new Error("Unable to upload the submission file to Google Drive.");
  }

  return {
    id: payload.id,
    name: typeof payload.name === "string" ? payload.name : artifact.fileName,
    webViewLink: typeof payload.webViewLink === "string" ? payload.webViewLink : undefined
  };
};

const readGoogleCourseWorkMaxPoints = async (
  binding: StudentLmsBinding,
  teacherAccessToken: string
): Promise<number | null> => {
  const response = await fetch(
    `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(binding.courseId)}/courseWork/${encodeURIComponent(binding.assignmentId)}`,
    {
      headers: { Authorization: `Bearer ${teacherAccessToken}` }
    }
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return null;
  }

  const maxPoints = Number(payload.maxPoints ?? Number.NaN);
  return Number.isFinite(maxPoints) && maxPoints > 0 ? maxPoints : null;
};

const googleGradeValue = async (
  binding: StudentLmsBinding,
  teacherAccessToken: string,
  submission: SubmissionResult
): Promise<number> => {
  const maxPoints = await readGoogleCourseWorkMaxPoints(binding, teacherAccessToken);
  const totalPoints = Number(submission.totalPoints);
  const score = Number(submission.score);

  if (maxPoints && Number.isFinite(totalPoints) && totalPoints > 0) {
    return Math.round((score / totalPoints) * maxPoints * 100) / 100;
  }

  return Math.round(score * 100) / 100;
};

const syncGoogleClassroomGrade = async (
  binding: StudentLmsBinding,
  teacherAccessToken: string | undefined,
  studentSubmissionId: string,
  submission: SubmissionResult
): Promise<Pick<StudentLmsTurnInState, "gradeSyncStatus" | "gradeSyncedAt" | "gradeValue" | "gradeSyncError">> => {
  if (!teacherAccessToken) {
    return {
      gradeSyncStatus: "skipped",
      gradeSyncError:
        "Grade sync needs the teacher's Google Classroom connection on this device. Student sign-in can turn in work, but students cannot write grades."
    };
  }

  try {
    const gradeValue = await googleGradeValue(binding, teacherAccessToken, submission);
    await fetchJson<Record<string, unknown>>(
      `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(binding.courseId)}/courseWork/${encodeURIComponent(binding.assignmentId)}/studentSubmissions/${encodeURIComponent(studentSubmissionId)}?updateMask=draftGrade,assignedGrade`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${teacherAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          draftGrade: gradeValue,
          assignedGrade: gradeValue
        })
      },
      "Unable to sync the grade to Google Classroom."
    );

    return {
      gradeSyncStatus: "success",
      gradeSyncedAt: new Date().toISOString(),
      gradeValue
    };
  } catch (error) {
    return {
      gradeSyncStatus: "failed",
      gradeSyncError:
        error instanceof Error
          ? error.message
          : "Google Classroom did not accept the grade update. Reconnect the teacher account and try again."
    };
  }
};

const turnInGoogleClassroom = async (
  binding: StudentLmsBinding,
  accessToken: string,
  artifact: SubmissionArtifact,
  submission: SubmissionResult,
  options: TurnInOptions = {}
): Promise<StudentLmsTurnInState> => {
  const baseUrl = `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(binding.courseId)}/courseWork/${encodeURIComponent(binding.assignmentId)}`;
  const submissionList = await fetchJson<{ studentSubmissions?: Array<Record<string, unknown>> }>(
    `${baseUrl}/studentSubmissions?userId=me&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    },
    "Unable to load the Google Classroom submission."
  );
  const studentSubmission = submissionList.studentSubmissions?.[0];
  if (!studentSubmission || typeof studentSubmission.id !== "string") {
    throw new Error("No Google Classroom submission was found for the signed-in student.");
  }

  if (studentSubmission.state === "TURNED_IN" || studentSubmission.state === "RETURNED") {
    const gradeSync = await syncGoogleClassroomGrade(binding, options.teacherAccessToken, studentSubmission.id, submission);
    return {
      provider: "google-classroom",
      status: "success",
      lastAttemptAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      externalReference: `${binding.courseId}/${binding.assignmentId}/${studentSubmission.id}`,
      ...gradeSync
    };
  }

  const uploadedFile = await uploadGoogleArtifact(accessToken, artifact);
  await fetchJson<Record<string, unknown>>(
    `${baseUrl}/studentSubmissions/${encodeURIComponent(studentSubmission.id)}/modifyAttachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        addAttachments: [
          {
            driveFile: {
              id: uploadedFile.id,
              title: uploadedFile.name,
              alternateLink: uploadedFile.webViewLink
            }
          }
        ]
      })
    },
    "Unable to attach the Lockedscreen submission to Google Classroom."
  );
  await fetchJson<Record<string, unknown>>(
    `${baseUrl}/studentSubmissions/${encodeURIComponent(studentSubmission.id)}:turnIn`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    },
    "Unable to turn in the Google Classroom submission."
  );

  const gradeSync = await syncGoogleClassroomGrade(binding, options.teacherAccessToken, studentSubmission.id, submission);

  return {
    provider: "google-classroom",
    status: "success",
    lastAttemptAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    externalReference: `${binding.courseId}/${binding.assignmentId}/${studentSubmission.id}`,
    ...gradeSync
  };
};

const uploadMicrosoftArtifact = async (
  accessToken: string,
  resourcesFolderUrl: string,
  artifact: SubmissionArtifact
): Promise<MicrosoftUploadedFile> => {
  const uploadUrl = `${resourcesFolderUrl}:/${encodeURIComponent(artifact.fileName)}:/content`;
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": artifact.mimeType
    },
    body: new Uint8Array(artifact.content)
  });
  const payload = (await response.json()) as Record<string, unknown>;
  const parentReference = payload.parentReference as Record<string, unknown> | undefined;
  if (!response.ok || typeof payload.id !== "string" || typeof parentReference?.driveId !== "string") {
    throw new Error("Unable to upload the submission file to Microsoft 365.");
  }

  return {
    driveId: parentReference.driveId,
    itemId: payload.id,
    webUrl: typeof payload.webUrl === "string" ? payload.webUrl : undefined
  };
};

const turnInMicrosoft365 = async (
  binding: StudentLmsBinding,
  accessToken: string,
  artifact: SubmissionArtifact
): Promise<StudentLmsTurnInState> => {
  const baseUrl = `https://graph.microsoft.com/v1.0/education/classes/${encodeURIComponent(binding.courseId)}/assignments/${encodeURIComponent(binding.assignmentId)}`;
  const submissionList = await fetchJson<{ value?: Array<Record<string, unknown>> }>(
    `${baseUrl}/submissions?$top=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    },
    "Unable to load the Microsoft 365 submission."
  );
  const submission = submissionList.value?.[0];
  if (!submission || typeof submission.id !== "string") {
    throw new Error("No Microsoft 365 submission was found for the signed-in student.");
  }

  if (submission.status === "submitted") {
    return {
      provider: "microsoft-365",
      status: "success",
      lastAttemptAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      externalReference: `${binding.courseId}/${binding.assignmentId}/${submission.id}`
    };
  }

  const folder = await fetchJson<{ resourcesFolderUrl?: string }>(
    `${baseUrl}/submissions/${encodeURIComponent(submission.id)}/setUpResourcesFolder`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` }
    },
    "Unable to prepare the Microsoft 365 submission folder."
  );
  if (!folder.resourcesFolderUrl) {
    throw new Error("Microsoft 365 did not return a submission resources folder.");
  }

  const uploadedFile = await uploadMicrosoftArtifact(accessToken, folder.resourcesFolderUrl, artifact);
  await fetchJson<Record<string, unknown>>(
    `${baseUrl}/submissions/${encodeURIComponent(submission.id)}/resources`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        resource: {
          "@odata.type": "#microsoft.graph.educationFileResource",
          displayName: artifact.fileName,
          fileUrl: `https://graph.microsoft.com/v1.0/drives/${uploadedFile.driveId}/items/${uploadedFile.itemId}`
        }
      })
    },
    "Unable to attach the Lockedscreen submission to Microsoft 365."
  );
  await fetchJson<Record<string, unknown>>(
    `${baseUrl}/submissions/${encodeURIComponent(submission.id)}/submit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` }
    },
    "Unable to turn in the Microsoft 365 submission."
  );

  return {
    provider: "microsoft-365",
    status: "success",
    lastAttemptAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    externalReference: uploadedFile.webUrl ?? `${binding.courseId}/${binding.assignmentId}/${submission.id}`
  };
};

export const turnInSubmissionToLms = async (
  parentWindow: BrowserWindow | null,
  configPackage: ExamConfigPackage,
  exam: Exam,
  submission: SubmissionResult,
  options: TurnInOptions = {}
): Promise<StudentLmsTurnInState> => {
  let binding = configPackage.studentLmsBinding;
  if (!binding.enabled) {
    throw new Error("Student LMS turn-in is not enabled for this package.");
  }

  if (!binding.courseId.trim()) {
    throw new Error("This package is missing the LMS class reference.");
  }

  const allowedEmailDomains = normalizeEmailDomains(configPackage.studentAccessPolicy.allowedEmailDomains);
  const tokens = await signInStudent(binding, parentWindow, allowedEmailDomains);
  assertStudentEmailDomainAllowed(configPackage, tokens.profileEmail);
  if (!binding.assignmentId.trim()) {
    if (binding.provider !== "google-classroom") {
      throw new Error("This package is missing the LMS assignment reference.");
    }
    binding = await recoverGoogleAssignmentBinding(configPackage, exam, tokens.accessToken);
  }
  const artifact = buildSubmissionArtifact(exam, submission);

  if (binding.provider === "google-classroom") {
    return turnInGoogleClassroom(binding, tokens.accessToken, artifact, submission, options);
  }

  return turnInMicrosoft365(binding, tokens.accessToken, artifact);
};
