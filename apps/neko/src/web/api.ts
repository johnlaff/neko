import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type {
  DailySource,
  HistoryResponse,
  ProjectionResponse,
  UserSettings,
} from "../shared/types.ts";

export type { DailySource, HistoryResponse, ProjectionResponse, UserSettings };

/** A browser signed in to this account; `current` is the one asking. */
export interface Device {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok)
    throw new ApiError(res.status, body.error ?? "unknown", body.message ?? res.statusText);
  // The service worker answers with the last good copy when the network is down.
  if (res.headers.get("x-neko-offline")) Object.assign(body, { offline: true });
  return body as T;
};

export const api = {
  config: () => request<{ googleClientId: string | null }>("/config"),
  me: () => request<{ email: string | null }>("/me"),
  login: (credential: string) =>
    request<{ email: string }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }),
  passkeyRegisterOptions: (invite: string) =>
    request<PublicKeyCredentialCreationOptionsJSON>("/passkey/register/options", {
      method: "POST",
      body: JSON.stringify({ invite }),
    }),
  passkeyRegister: (invite: string, response: RegistrationResponseJSON) =>
    request<{ email: string }>("/passkey/register/verify", {
      method: "POST",
      body: JSON.stringify({ invite, response }),
    }),
  passkeyLoginOptions: () =>
    request<PublicKeyCredentialRequestOptionsJSON>("/passkey/login/options", { method: "POST" }),
  passkeyLogin: (response: AuthenticationResponseJSON) =>
    request<{ email: string }>("/passkey/login/verify", {
      method: "POST",
      body: JSON.stringify({ response }),
    }),
  logout: () => {
    navigator.serviceWorker?.controller?.postMessage("logout");
    return request<{ ok: true }>("/auth/logout", { method: "POST" });
  },
  projection: () => request<ProjectionResponse & { offline?: true }>("/projection"),
  pushKey: () => request<{ publicKey: string | null }>("/push/key"),
  subscribePush: (s: PushSubscriptionJSON) =>
    request<{ ok: true }>("/push/subscription", { method: "POST", body: JSON.stringify(s) }),
  unsubscribePush: (endpoint: string) =>
    request<{ ok: true }>("/push/subscription", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),
  sessions: () => request<Device[]>("/sessions"),
  endSession: (id: string) =>
    request<{ ok: true }>(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  endOtherSessions: () => request<{ ok: true }>("/sessions/others", { method: "DELETE" }),
  history: () => request<HistoryResponse>("/history"),
  // A Worker older than the screen (mid-deploy, or a stale cache) can leave out a newer field.
  settings: () =>
    request<UserSettings>("/settings").then((s) => ({ ...s, reviewed: s.reviewed ?? [] })),
  saveSettings: (s: UserSettings) =>
    request<UserSettings>("/settings", { method: "PUT", body: JSON.stringify(s) }),
};
