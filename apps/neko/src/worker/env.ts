export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SHEET_ID: string;
  ALLOWED_EMAILS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
  SESSION_SECRET: string;
  /** Web Push (RFC 8292): public key goes to browsers; the private key is a Worker secret. */
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  /** Sentry project key (public by design); empty turns error reporting off. */
  SENTRY_DSN?: string;
  /** Workers rate limiting for sign-in routes; absent in tests and local dev. */
  AUTH_LIMIT?: RateLimit;
}

export type AppEnv = { Bindings: Env; Variables: { email: string; session: string } };
