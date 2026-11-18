import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  buildNoticeEmail,
  cleanNoticeBody,
  cleanNoticeSubject,
  collectRecipientEmails,
  type MemberEmailRow,
} from "./noticeLogic";

export type Env = {
  FIREBASE_PROJECT_ID: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  FILES?: R2Bucket;
};

type SendBody = {
  tableId?: unknown;
  subject?: unknown;
  body?: unknown;
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({ ok: true, service: "table-notice", files: Boolean(env.FILES) }, 200, request);
      }
      if (request.method === "POST" && url.pathname === "/sendNotice") {
        return await handleSendNotice(request, env);
      }
      if (request.method === "POST" && url.pathname === "/files/upload") {
        return await handleFileUpload(request, env);
      }
      if (request.method === "GET" && url.pathname === "/files/download") {
        return await handleFileDownload(request, env, url);
      }
      if (request.method === "DELETE" && url.pathname === "/files/object") {
        return await handleFileDelete(request, env, url);
      }
      return json({ error: "Not found." }, 404, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      const status =
        message === "Sign in first."
          ? 401
          : message.startsWith("Only table members") || message.includes("cannot open")
            ? 403
            : message.includes("email for reminders")
              ? 409
              : message.includes("could not be found")
                ? 404
                : message.includes("5 MB") ||
                    message.includes("image") ||
                    message.includes("characters") ||
                    message.includes("table id") ||
                    message.includes("email address") ||
                    message.includes("file id")
                  ? 400
                  : message.includes("not configured")
                    ? 503
                    : 500;
      return json({ error: message }, status, request);
    }
  },
};

async function requireUid(request: Request, env: Env): Promise<{ uid: string; idToken: string }> {
  if (!env.FIREBASE_PROJECT_ID) throw new Error("Firebase project is not configured on the server.");
  const authHeader = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) throw new Error("Sign in first.");
  const idToken = match[1];
  const verified = await jwtVerify(idToken, googleJwks, {
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
    audience: env.FIREBASE_PROJECT_ID,
  });
  const uid = typeof verified.payload.user_id === "string" ? verified.payload.user_id : "";
  if (!uid) throw new Error("Sign in first.");
  return { uid, idToken };
}

async function requireMember(projectId: string, idToken: string, uid: string, tableId: string) {
  const member = await firestoreGet(projectId, idToken, `tables/${tableId}/members/${uid}`);
  if (!member) throw new Error("Only table members can use files at this table.");
  return member;
}

async function handleSendNotice(request: Request, env: Env): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    throw new Error("Email sending is not configured on the server.");
  }
  const { uid, idToken } = await requireUid(request, env);
  const payload = (await request.json()) as SendBody;
  const tableId = typeof payload.tableId === "string" ? payload.tableId.trim() : "";
  if (!tableId) throw new Error("Choose a table id.");

  const subject = cleanNoticeSubject(typeof payload.subject === "string" ? payload.subject : "");
  const body = cleanNoticeBody(typeof payload.body === "string" ? payload.body : "");

  const table = await firestoreGet(env.FIREBASE_PROJECT_ID, idToken, `tables/${tableId}`);
  if (!table) throw new Error("That table could not be found.");

  const members = await firestoreListMembers(env.FIREBASE_PROJECT_ID, idToken, tableId);
  const me = members.find((member) => member.uid === uid);
  if (!me) throw new Error("Only table members can send a notice.");

  const recipients = collectRecipientEmails(members);
  if (recipients.length === 0) {
    const someoneMuted = members.some((member) => member.noticesMuted && (member.email || "").trim());
    throw new Error(
      someoneMuted
        ? "Everyone with a reminder email has muted notices for this table."
        : "No one at this table has an email for reminders yet. Add one on your seat first.",
    );
  }

  const tableName = stringField(table, "name") || "Table";
  const senderName = me.displayName?.trim() || "Member";
  const mail = buildNoticeEmail({ tableName, subject, body, senderName });

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: recipients,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
  });
  const sentJson = (await sent.json()) as { id?: string; message?: string };
  if (!sent.ok) {
    throw new Error(sentJson.message || "Resend rejected the email.");
  }

  const noticeId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const sentAt = Date.now();
  await firestoreCreateNotice(env.FIREBASE_PROJECT_ID, idToken, tableId, noticeId, {
    subject: mail.subject,
    body,
    sentBy: uid,
    sentAt,
    to: recipients,
  });

  return json({ noticeId, recipientCount: recipients.length }, 200, request);
}

async function handleFileUpload(request: Request, env: Env): Promise<Response> {
  if (!env.FILES) throw new Error("File storage is not configured on the server.");
  const { uid, idToken } = await requireUid(request, env);
  const tableId = (request.headers.get("X-Table-Id") || "").trim();
  const fileId = (request.headers.get("X-File-Id") || "").trim();
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  if (!tableId) throw new Error("Choose a table id.");
  if (!fileId) throw new Error("Choose a file id.");
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new Error("Use an image (JPEG, PNG, WebP, GIF) or a PDF.");
  }

  await requireMember(env.FIREBASE_PROJECT_ID, idToken, uid, tableId);
  const meta = await firestoreGet(env.FIREBASE_PROJECT_ID, idToken, `tables/${tableId}/files/${fileId}`);
  if (!meta) throw new Error("Save the file details before uploading bytes.");
  if (stringField(meta, "ownerId") !== uid) {
    throw new Error("Only the uploader can store this file.");
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("Files must be at most 5 MB.");
  }
  const declaredSize = numberField(meta, "size");
  if (declaredSize && Math.abs(declaredSize - bytes.byteLength) > 1) {
    throw new Error("File size did not match what was saved.");
  }

  await env.FILES.put(objectKey(tableId, fileId), bytes, {
    httpMetadata: { contentType },
    customMetadata: { ownerId: uid, tableId, fileId },
  });
  return json({ ok: true, fileId, size: bytes.byteLength }, 200, request);
}

async function handleFileDownload(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.FILES) throw new Error("File storage is not configured on the server.");
  const { uid, idToken } = await requireUid(request, env);
  const tableId = (url.searchParams.get("tableId") || "").trim();
  const fileId = (url.searchParams.get("fileId") || "").trim();
  if (!tableId) throw new Error("Choose a table id.");
  if (!fileId) throw new Error("Choose a file id.");

  await requireMember(env.FIREBASE_PROJECT_ID, idToken, uid, tableId);
  const meta = await firestoreGet(env.FIREBASE_PROJECT_ID, idToken, `tables/${tableId}/files/${fileId}`);
  if (!meta) throw new Error("That file could not be found.");
  if (!canViewFile(uid, meta)) throw new Error("You cannot open that file.");

  const object = await env.FILES.get(objectKey(tableId, fileId));
  if (!object) throw new Error("That file could not be found.");
  const headers = new Headers(corsHeaders(request));
  headers.set("Content-Type", stringField(meta, "contentType") || object.httpMetadata?.contentType || "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `inline; filename="${sanitizeFilename(stringField(meta, "name") || fileId)}"`,
  );
  headers.set("Cache-Control", "private, max-age=60");
  return new Response(object.body, { status: 200, headers });
}

async function handleFileDelete(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.FILES) throw new Error("File storage is not configured on the server.");
  const { uid, idToken } = await requireUid(request, env);
  const tableId = (url.searchParams.get("tableId") || "").trim();
  const fileId = (url.searchParams.get("fileId") || "").trim();
  if (!tableId) throw new Error("Choose a table id.");
  if (!fileId) throw new Error("Choose a file id.");

  await requireMember(env.FIREBASE_PROJECT_ID, idToken, uid, tableId);
  const meta = await firestoreGet(env.FIREBASE_PROJECT_ID, idToken, `tables/${tableId}/files/${fileId}`);
  if (meta && stringField(meta, "ownerId") !== uid) {
    throw new Error("Only the uploader can delete this file.");
  }
  await env.FILES.delete(objectKey(tableId, fileId));
  return json({ ok: true }, 200, request);
}

function canViewFile(uid: string, meta: Record<string, unknown>): boolean {
  const ownerId = stringField(meta, "ownerId");
  if (ownerId === uid) return true;
  const visibility = stringField(meta, "visibility");
  if (visibility === "table") return true;
  if (visibility === "shared") {
    return listField(meta, "sharedWith").includes(uid);
  }
  return false;
}

function objectKey(tableId: string, fileId: string): string {
  return `tables/${tableId}/files/${fileId}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\- ()]+/g, "_").slice(0, 80) || "file";
}

async function firestoreGet(
  projectId: string,
  idToken: string,
  docPath: string,
): Promise<Record<string, unknown> | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    if (response.status === 403) throw new Error("Only table members can use files at this table.");
    throw new Error("That table could not be found.");
  }
  const data = (await response.json()) as { fields?: Record<string, unknown> };
  return data.fields ?? {};
}

async function firestoreListMembers(
  projectId: string,
  idToken: string,
  tableId: string,
): Promise<MemberEmailRow[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tables/${tableId}/members`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error("Only table members can send a notice.");
    throw new Error("That table could not be found.");
  }
  const data = (await response.json()) as {
    documents?: Array<{ name?: string; fields?: Record<string, unknown> }>;
  };
  return (data.documents ?? []).map((doc) => {
    const uid = (doc.name || "").split("/").pop() || "";
    return {
      uid,
      email: stringField(doc.fields ?? {}, "email"),
      displayName: stringField(doc.fields ?? {}, "displayName"),
      noticesMuted: booleanField(doc.fields ?? {}, "noticesMuted"),
    };
  });
}

async function firestoreCreateNotice(
  projectId: string,
  idToken: string,
  tableId: string,
  noticeId: string,
  notice: { subject: string; body: string; sentBy: string; sentAt: number; to: string[] },
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tables/${tableId}/notices?documentId=${noticeId}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        subject: { stringValue: notice.subject },
        body: { stringValue: notice.body },
        sentBy: { stringValue: notice.sentBy },
        sentAt: { doubleValue: notice.sentAt },
        to: {
          arrayValue: {
            values: notice.to.map((address) => ({ stringValue: address })),
          },
        },
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Notice was emailed, but the log could not be saved. ${text.slice(0, 180)}`);
  }
}

function booleanField(fields: Record<string, unknown>, key: string): boolean {
  const value = fields[key];
  if (!value || typeof value !== "object") return false;
  return (value as { booleanValue?: unknown }).booleanValue === true;
}

function stringField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (!value || typeof value !== "object") return "";
  const record = value as { stringValue?: unknown };
  return typeof record.stringValue === "string" ? record.stringValue : "";
}

function numberField(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (!value || typeof value !== "object") return 0;
  const record = value as { integerValue?: unknown; doubleValue?: unknown };
  if (typeof record.doubleValue === "number") return record.doubleValue;
  if (typeof record.integerValue === "string") return Number(record.integerValue);
  if (typeof record.integerValue === "number") return record.integerValue;
  return 0;
}

function listField(fields: Record<string, unknown>, key: string): string[] {
  const value = fields[key];
  if (!value || typeof value !== "object") return [];
  const record = value as { arrayValue?: { values?: Array<{ stringValue?: unknown }> } };
  return (record.arrayValue?.values ?? [])
    .map((item) => (typeof item.stringValue === "string" ? item.stringValue : ""))
    .filter(Boolean);
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Table-Id, X-File-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}
