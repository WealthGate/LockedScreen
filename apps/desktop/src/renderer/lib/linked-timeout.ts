interface HostedView { executeJavaScript?: (script: string) => Promise<unknown>; getURL?: () => string }

// Runs only inside the already-authorized guest. Never read answers, fill
// required fields, advance sections, synthesize an API request or open a tab.
export function clickFinalFormSubmit(expectedId: string): boolean {
  if (location.origin !== "https://docs.google.com") return false;
  const path = /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([\w-]+)\/(?:viewform|formResponse)\/?$/;
  const id = path.exec(location.pathname)?.[1];
  if (!id || id !== expectedId) return false;
  const buttons: HTMLElement[] = [];
  for (const form of Array.from(document.forms)) {
    const action = new URL(form.action, location.href);
    if (action.origin !== location.origin || path.exec(action.pathname)?.[1] !== id || !action.pathname.endsWith("/formResponse")) continue;
    for (const el of Array.from(form.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'))) {
      const label = (el.getAttribute("aria-label") || el.innerText || (el instanceof HTMLInputElement ? el.value : "")).trim();
      if (!["Submit", "Enviar", "Envoyer"].includes(label) || el.matches(":disabled,[aria-disabled=true]") || !el.getClientRects().length) continue;
      buttons.push(el);
    }
  }
  if (buttons.length !== 1) return false;
  buttons[0]!.click();
  return true;
}

export async function attemptLinkedTimeout(view: HostedView | null, assigned: string): Promise<"attempted"|"not-attempted"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!view?.executeJavaScript) return "not-attempted";
    const current = new URL(view.getURL?.() ?? ""), start = new URL(assigned);
    const formPath = /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([\w-]+)\/(?:viewform|formResponse)\/?$/;
    const currentId = formPath.exec(current.pathname)?.[1];
    if (current.origin !== "https://docs.google.com" || !currentId ||
        !(start.origin === "https://docs.google.com" && formPath.exec(start.pathname)?.[1] === currentId ||
          start.origin === "https://forms.gle" && /^\/[\w-]+\/?$/.test(start.pathname))) return "not-attempted";
    const clicked = await Promise.race([view.executeJavaScript(`(${clickFinalFormSubmit.toString()})(${JSON.stringify(currentId)})`),
      new Promise<boolean>(resolve => {timer = setTimeout(() => resolve(false), 1500);})]);
    return clicked === true ? "attempted" : "not-attempted";
  } catch { return "not-attempted"; } finally { clearTimeout(timer); }
}
