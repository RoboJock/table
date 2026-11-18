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
};

type SendBody = {
  tableId?: unknown;
  subject?: unknown;
  body?: unknown;
};

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "table-notice" }, 200, request);
    }

    if (request.method !== "POST" || url.pathname !== "/sendNotice") {
      return json({ error: "Not found." }, 404, request);
    }

    try {
      return await handleSendNotice(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      const status =
        message === "Sign in first."
          ? 401
          : message.startsWith("Only table members")
            ? 403
            : message.includes("email for reminders")
              ? 409
              : message.includes("could not be found")
                ? 404
                : message.includes("characters") || message.includes("table id") || message.includes("email address")
                  ? 400
                  : 500;
      return json({ error: message }, status, request);
    }
  },
};

async function handleSendNotice(request: Request, env: Env): Promise<Response> {
  if (!env.FIREBASE_PROJECT_ID) throw new Error("Firebase project is not configured on the server.");
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    throw new Error("Email sending is not configured on the server.");
  }

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
    throw new Error("No one at this table has an email for reminders yet. Add one on your seat first.");
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
    if (response.status === 403) throw new Error("Only table members can send a notice.");
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

function stringField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (!value || typeof value !== "object") return "";
  const record = value as { stringValue?: unknown };
  return typeof record.stringValue === "string" ? record.stringValue : "";
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
