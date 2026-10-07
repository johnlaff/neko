import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ApiError } from "./api.ts";
import { reportError } from "./report.ts";
import { warmFromDevice } from "./warm.ts";
import "./styles.css";

/** An expired session answers 401 on any call: drop back to login instead of showing an error. */
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401)
        queryClient.setQueryData(["me"], { email: null });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
    },
  },
});

/**
 * A page left open across a deploy can ask for a chunk the new build no longer has. Reloading
 * picks up the new build; the timestamp keeps a real outage from turning into a reload loop.
 */
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem("neko-reload") ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem("neko-reload", String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

window.addEventListener("error", (event) => reportError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => {
  // Failed API calls already show in the screen and in the Worker logs.
  if (!(event.reason instanceof ApiError)) reportError(event.reason);
});

if (import.meta.env.PROD && "serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});

const root = document.getElementById("root");
// Reading the device copy takes a few milliseconds; waiting for it avoids a skeleton flash.
if (root)
  warmFromDevice(queryClient).finally(() =>
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
