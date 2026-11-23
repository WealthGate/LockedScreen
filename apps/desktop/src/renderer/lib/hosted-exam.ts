export const isHostedFormCompletionUrl = (candidateUrl: string): boolean => {
  try {
    const url = new URL(candidateUrl);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname === "docs.google.com" &&
      /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+\/formResponse\/?$/.test(url.pathname);
  } catch { return false; }
};

// A response URL is only a navigation hint: it can also contain validation errors.
// Google, not this URL check or the local session record, owns submission/grade proof.
export const hostedSubmissionNotice = "This saves a local session record only. Submit inside the form first and check its confirmation. The form provider keeps your answers, response limit and grade.";
