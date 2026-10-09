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
  /** Android app id, published in assetlinks.json so the app can use this site's passkeys. */
  ANDROID_PACKAGE?: string;
  /** SHA-256 fingerprints of the app's signing certificates, comma-separated. */
  ANDROID_CERT_SHA256?: string;
  /** Meu Pluggy application keys (Worker secrets); absent, Open Finance stays off. */
  PLUGGY_CLIENT_ID?: string;
  PLUGGY_CLIENT_SECRET?: string;
  /** Sent back by Pluggy in a header on every webhook, proving the call came from it. */
  PLUGGY_WEBHOOK_SECRET?: string;
  /** This site's public origin, for the webhook address registered at Pluggy. */
  SITE_URL?: string;
  /** Key of the neko-writer account (Editor of the sheet); absent, Neko writes nothing. */
  NEKO_WRITER_SERVICE_ACCOUNT_JSON?: string;
  /** Key of the Console workspace "mia" (US$ 80 limit); absent, Mia stays off. */
  ANTHROPIC_API_KEY?: string;
  /** Workers rate limiting for sign-in routes; absent in tests and local dev. */
  AUTH_LIMIT?: RateLimit;
}

export type AppEnv = { Bindings: Env; Variables: { email: string; session: string } };
