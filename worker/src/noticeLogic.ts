export type MemberEmailRow = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
};

export function cleanEmail(email: string): string {
  const trimmed = email.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.length > 254) {
    throw new Error("That email address is too long.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error("That email address does not look valid.");
  }
  return trimmed.toLowerCase();
}

export function cleanNoticeSubject(subject: string): string {
  const trimmed = subject.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new Error("Use a subject between 1 and 120 characters.");
  }
  return trimmed;
}

export function cleanNoticeBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    throw new Error("Use a notice body between 1 and 2000 characters.");
  }
  return trimmed;
}

export function collectRecipientEmails(members: MemberEmailRow[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const member of members) {
    const address = cleanEmail(typeof member.email === "string" ? member.email : "");
    if (!address || seen.has(address)) continue;
    seen.add(address);
    list.push(address);
  }
  return list;
}

export function buildNoticeEmail(input: {
  tableName: string;
  subject: string;
  body: string;
  senderName: string;
}): { subject: string; text: string; html: string } {
  const subject = cleanNoticeSubject(input.subject);
  const body = cleanNoticeBody(input.body);
  const text = [
    `Notice from ${input.tableName}`,
    `From: ${input.senderName}`,
    "",
    body,
    "",
    "— Sent by Table",
  ].join("\n");
  const html = [
    `<p><strong>Notice from ${escapeHtml(input.tableName)}</strong></p>`,
    `<p>From: ${escapeHtml(input.senderName)}</p>`,
    `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
    `<p style="color:#667;font-size:12px">Sent by Table</p>`,
  ].join("");
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
