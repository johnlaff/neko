import type { Draft, MiaEntry } from "@neko/engine";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type {
  BanksResponse,
  DailySource,
  HistoryResponse,
  MiaReply,
  MiaStatus,
  ProjectionResponse,
  UserSettings,
} from "../shared/types.ts";

export type {
  BanksResponse,
  DailySource,
  HistoryResponse,
  MiaReply,
  MiaStatus,
  ProjectionResponse,
  UserSettings,
};

/** What Mia gets with a question: the last exchanges and the values they showed. */
export interface MiaAsk {
  pergunta: string;
  historico: readonly { pergunta: string; resposta: string }[];
  valores: MiaReply["valores"];
}

/** A browser signed in to this account; `current` is the one asking. */
export interface Device {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

/** Settings the Ajustes form does not send; the Worker keeps them. */
export type KeptSetting =
  | "bankCards"
  | "accountUse"
  | "savedOrigins"
  | "writing"
  | "previstoSince"
  | "previstoUndo";

/** What a launch or an undo did; `error` says why a part failed. */
export interface LaunchResult {
  entryId: string;
  state: "done" | "failed" | "undone";
  error?: string;
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

/** How long a call may wait, like the app's: 30 s, and 90 s for Mia and writes to the sheet. */
const WAIT = 30_000;
const LONG_WAIT = 90_000;

const request = async <T>(path: string, init?: RequestInit, wait = WAIT): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    credentials: "same-origin",
    signal: AbortSignal.timeout(wait),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok)
    throw new ApiError(res.status, body.error ?? "unknown", body.message ?? res.statusText);
  // The service worker answers with the last good copy when the network is down.
  if (res.headers.get("x-neko-offline")) Object.assign(body, { offline: true });
  return body as T;
};

/** Worker refusals whose message is written for the owner; any other text stays out of sight. */
const SPOKEN = new Set(["busy", "write", "writing-off", "sheet-structure"]);

/**
 * Why an action failed, in Portuguese the owner can act on: the Worker's own words when it
 * refused, and plain advice when the connection dropped (the same tap again writes once).
 */
export const reasonOf = (e: unknown): string => {
  if (e instanceof ApiError && SPOKEN.has(e.code) && e.message)
    return e.message.replace(/^./, (c) => c.toUpperCase());
  if (e instanceof ApiError) return "O Neko não conseguiu agora. Tente de novo daqui a pouco.";
  return "A conexão caiu antes da resposta. Toque de novo: nada é gravado duas vezes.";
};

/** Ids of writes whose answer never came: the same write again sends the same id, which writes once. */
const unanswered = new Map<string, string>();

export const once = async <T>(what: string, run: (id: string) => Promise<T>): Promise<T> => {
  const id = unanswered.get(what) ?? crypto.randomUUID();
  unanswered.set(what, id);
  try {
    const result = await run(id);
    unanswered.delete(what);
    return result;
  } catch (e) {
    if (e instanceof ApiError) unanswered.delete(what);
    throw e;
  }
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
  /** Fields set elsewhere (Bancos, Para lançar) are kept by the Worker when left out. */
  saveSettings: (s: Omit<UserSettings, KeptSetting> & Partial<Pick<UserSettings, KeptSetting>>) =>
    request<UserSettings>("/settings", { method: "PUT", body: JSON.stringify(s) }),
  banks: () => request<BanksResponse>("/banks"),
  saveBanks: (items: readonly { itemId: string; label: string }[]) =>
    request<{ ok: true }>("/banks", { method: "PUT", body: JSON.stringify({ items }) }),
  mia: () => request<MiaStatus>("/mia"),
  askMia: (ask: MiaAsk) =>
    request<MiaReply>("/mia", { method: "POST", body: JSON.stringify(ask) }, LONG_WAIT),
  miaEntry: (frase: string, cartoes: readonly string[]) =>
    request<{ lancamento: MiaEntry | null }>(
      "/mia/lancamento",
      {
        method: "POST",
        body: JSON.stringify({ frase, cartoes }),
      },
      LONG_WAIT,
    ),
  /** One request: the Worker reads each cell and writes only if every changed line still holds what Neko saw. */
  launch: (body: { id: string; draft: Draft; key?: string }) =>
    request<LaunchResult>("/entries", { method: "POST", body: JSON.stringify(body) }, LONG_WAIT),
  /** Atualizar agora: the banks read now instead of at the next morning sync. */
  refreshBanks: () => request<{ ok: boolean }>("/banks/refresh", { method: "POST" }),
  undoEntry: (id: string) =>
    request<LaunchResult>(`/entries/${encodeURIComponent(id)}/undo`, { method: "POST" }, LONG_WAIT),
  /** The Diário previsto on the days ahead at `value` per day; 0 takes it away. */
  previsto: (id: string, value: number) =>
    request<LaunchResult>(
      "/entries/previsto",
      { method: "POST", body: JSON.stringify({ id, value }) },
      LONG_WAIT,
    ),
  /** The review every 3 months, answered "keep the value". */
  keepPrevisto: () => request<{ ok: true }>("/queue/previsto/manter", { method: "POST" }),
  ignore: (key: string) =>
    request<{ ok: true }>("/queue/ignore", { method: "POST", body: JSON.stringify({ key }) }),
  unignore: (key: string) =>
    request<{ ok: true }>("/queue/unignore", { method: "POST", body: JSON.stringify({ key }) }),
  accountUse: (account: string, use: "guardado" | "corrente") =>
    request<{ ok: true }>("/queue/account", {
      method: "POST",
      body: JSON.stringify({ account, use }),
    }),
  saveBankCards: (cards: UserSettings["bankCards"]) =>
    request<{ ok: true }>("/banks/cards", { method: "PUT", body: JSON.stringify({ cards }) }),
};
