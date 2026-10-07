/** Most reports sent per page load: one broken loop should not flood the logs. */
const MAX_REPORTS = 5;
let sent = 0;

/** Sends an error to the Worker logs. Best effort: a failed report is dropped silently. */
export const reportError = (error: unknown): void => {
  if (!import.meta.env.PROD || sent >= MAX_REPORTS) return;
  sent++;
  const e = error instanceof Error ? error : new Error(String(error));
  fetch("/api/client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify({
      message: e.message.slice(0, 500),
      stack: e.stack?.slice(0, 4000),
      url: location.pathname.slice(0, 300),
    }),
  }).catch(() => {});
};
