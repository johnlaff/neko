import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

const ServiceAccount = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

/** Reading: Neko's reader account is a Viewer and asks only for read scopes. */
export const READ_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");

/** Writing entries (specs/005-lancamentos): only the separate neko-writer account asks for this. */
export const WRITE_SCOPES = "https://www.googleapis.com/auth/spreadsheets";

const cached = new Map<string, { token: string; expires: number }>();

export const accessToken = async (
  serviceAccountJson: string,
  now = Date.now(),
  scopes = READ_SCOPES,
): Promise<string> => {
  const sa = ServiceAccount.parse(JSON.parse(serviceAccountJson));
  const key = `${sa.client_email} ${scopes}`;
  const hit = cached.get(key);
  if (hit && hit.expires - 60_000 > now) return hit.token;
  const pkcs8 = await importPKCS8(sa.private_key, "RS256");
  const iat = Math.floor(now / 1000);
  const assertion = await new SignJWT({ scope: scopes })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(pkcs8);
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
  cached.set(key, { token: body.access_token, expires: now + body.expires_in * 1000 });
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

/** When each kept revision of the file was saved, oldest first. */
export const revisionTimes = async (sheetId: string, token: string): Promise<string[]> => {
  const out: string[] = [];
  let page: string | undefined;
  do {
    const qs = new URLSearchParams({
      fields: "nextPageToken,revisions(modifiedTime)",
      pageSize: "1000",
    });
    if (page) qs.set("pageToken", page);
    const body = z
      .object({
        nextPageToken: z.string().optional(),
        revisions: z.array(z.object({ modifiedTime: z.string() })).default([]),
      })
      .parse(
        await getJson(
          `https://www.googleapis.com/drive/v3/files/${sheetId}/revisions?${qs}`,
          token,
        ),
      );
    out.push(...body.revisions.map((r) => r.modifiedTime));
    page = body.nextPageToken;
  } while (page && out.length < 10_000);
  return out;
};

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
