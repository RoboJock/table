import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { Resend } from "resend";
import {
  buildNoticeEmail,
  cleanNoticeBody,
  cleanNoticeSubject,
  collectRecipientEmails,
} from "./noticeLogic";

initializeApp();

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFrom = defineSecret("RESEND_FROM");

type SendNoticeRequest = {
  tableId?: unknown;
  subject?: unknown;
  body?: unknown;
};

export const sendNotice = onCall(
  {
    secrets: [resendApiKey, resendFrom],
    region: "us-central1",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in first.");
    }

    const data = (request.data ?? {}) as SendNoticeRequest;
    const tableId = typeof data.tableId === "string" ? data.tableId.trim() : "";
    if (!tableId) {
      throw new HttpsError("invalid-argument", "Choose a table id.");
    }

    let subject: string;
    let body: string;
    try {
      subject = cleanNoticeSubject(typeof data.subject === "string" ? data.subject : "");
      body = cleanNoticeBody(typeof data.body === "string" ? data.body : "");
    } catch (error) {
      throw new HttpsError(
        "invalid-argument",
        error instanceof Error ? error.message : "That notice is invalid.",
      );
    }

    const db = getFirestore();
    const tableRef = db.collection("tables").doc(tableId);
    const tableSnap = await tableRef.get();
    if (!tableSnap.exists) {
      throw new HttpsError("not-found", "That table could not be found.");
    }

    const memberRef = tableRef.collection("members").doc(request.auth.uid);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      throw new HttpsError("permission-denied", "Only table members can send a notice.");
    }

    const membersSnap = await tableRef.collection("members").get();
    const recipients = collectRecipientEmails(
      membersSnap.docs.map((doc) => ({
        uid: doc.id,
        email: typeof doc.data().email === "string" ? doc.data().email : "",
      })),
    );
    if (recipients.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No member emails are saved yet. Each member should add an email on their seat.",
      );
    }

    const tableName =
      typeof tableSnap.data()?.name === "string" ? String(tableSnap.data()?.name) : "Table";
    const senderName =
      typeof memberSnap.data()?.displayName === "string"
        ? String(memberSnap.data()?.displayName)
        : "Member";

    const mail = buildNoticeEmail({
      tableName,
      subject,
      body,
      senderName,
    });

    const apiKey = resendApiKey.value();
    const from = resendFrom.value();
    if (!apiKey || !from) {
      throw new HttpsError("failed-precondition", "Email sending is not configured on the server.");
    }

    const resend = new Resend(apiKey);
    const sent = await resend.emails.send({
      from,
      to: recipients,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (sent.error) {
      throw new HttpsError("internal", sent.error.message || "Resend rejected the email.");
    }

    const noticeRef = tableRef.collection("notices").doc();
    await noticeRef.set({
      subject: mail.subject,
      body,
      sentBy: request.auth.uid,
      sentAt: Date.now(),
      to: recipients,
      providerId: sent.data?.id ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      noticeId: noticeRef.id,
      recipientCount: recipients.length,
    };
  },
);
