export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (ch) => ch.charCodeAt(0));

/** 256 random bits, base64url: session ids and invite links. */
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

/** SHA-256 of a token, hex. Only this goes to the database, so a copy of it opens nothing. */
export const hashToken = async (token: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
