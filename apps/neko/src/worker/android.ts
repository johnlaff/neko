import type { Env } from "./env.ts";

/** "AB:CD:…" → the bytes it names; null when it is not a SHA-256 fingerprint. */
const fingerprintBytes = (fp: string): Uint8Array | null => {
  const hex = fp.replace(/:/g, "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
};

/** Signing certificates the Android app may carry, from ANDROID_CERT_SHA256 (comma-separated). */
export const androidFingerprints = (env: Pick<Env, "ANDROID_CERT_SHA256">): string[] =>
  (env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => fingerprintBytes(s) !== null);

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * Origins a passkey assertion from the Android app reports: the app's signing certificate, not a
 * web address (`android:apk-key-hash:<base64url SHA-256>`). Only the certificates listed here,
 * the same ones assetlinks.json vouches for, can sign in.
 */
export const androidOrigins = (env: Pick<Env, "ANDROID_CERT_SHA256">): string[] =>
  androidFingerprints(env).map(
    (fp) => `android:apk-key-hash:${b64url(fingerprintBytes(fp) ?? new Uint8Array())}`,
  );

/**
 * Digital Asset Links: tells Android that the app with this package and certificate speaks for
 * this site, so Credential Manager offers it the site's passkeys.
 */
export const assetLinks = (env: Pick<Env, "ANDROID_PACKAGE" | "ANDROID_CERT_SHA256">) => {
  const fingerprints = androidFingerprints(env);
  if (!env.ANDROID_PACKAGE || fingerprints.length === 0) return [];
  return [
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: env.ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
};
