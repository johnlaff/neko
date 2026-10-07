import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

const ServiceAccount = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

/** Read-only by construction: Neko's account is a Viewer and asks only for read scopes. */
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");

let cached: { token: string; expires: number } | null = null;

export const accessToken = async (
  serviceAccountJson: string,
  now = Date.now(),
): Promise<string> => {
  if (cached && cached.expires - 60_000 > now) return cached.token;
  const sa = ServiceAccount.parse(JSON.parse(serviceAccountJson));
  const key = await importPKCS8(sa.private_key, "RS256");
  const iat = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: SCOPES })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Google token: ${res.status} ${await res.text()}`);
  const body = z
    .object({ access_token: z.string(), expires_in: z.number() })
    .parse(await res.json());
  cached = { token: body.access_token, expires: now + body.expires_in * 1000 };
  return body.access_token;
};

const getJson = async (url: string, token: string): Promise<unknown> => {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok)
    throw new Error(`Google ${new URL(url).pathname}: ${res.status} ${await res.text()}`);
  return res.json();
};

/** Drive's file version bumps on every edit: one cheap call decides whether to re-read. */
export const fileVersion = async (
  sheetId: string,
  token: string,
): Promise<{ version: string; modifiedTime: string }> =>
  z
    .object({ version: z.string(), modifiedTime: z.string() })
    .parse(
      await getJson(
        `https://www.googleapis.com/drive/v3/files/${sheetId}?fields=version,modifiedTime`,
        token,
      ),
    );

/** Tab title → gid, used to pick year tabs and to deep-link a cell. */
export const tabs = async (sheetId: string, token: string): Promise<Record<string, number>> => {
  const body = z
    .object({
      sheets: z.array(
        z.object({ properties: z.object({ title: z.string(), sheetId: z.number() }) }),
      ),
    })
    .parse(
      await getJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(title,sheetId)`,
        token,
      ),
    );
  return Object.fromEntries(body.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
};

export const spreadsheet = async (
  sheetId: string,
  token: string,
  ranges: string[],
  fields: string,
) => {
  const qs = new URLSearchParams({ fields, includeGridData: "true" });
  for (const r of ranges) qs.append("ranges", r);
  return getJson(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?${qs}`, token);
};
