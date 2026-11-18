import type { ActivityDoc, ChatMessage, FileDoc, MemberDoc, NoticeDoc, TableDoc } from "./types";
import { joinPolicyLabel } from "./tables";

export type TableExportPayload = {
  exportedAt: number;
  table: {
    id: string;
    name: string;
    joinCode: string;
    seatLimit: number;
    joinPolicy: string;
    memberCount: number;
    archived: boolean;
    archivedAt: number;
    createdAt: number;
  };
  members: Array<{
    uid: string;
    displayName: string;
    role: string;
    seatNote: string;
    email: string;
    joinedAt: number;
  }>;
  notices: Array<{
    id: string;
    subject: string;
    body: string;
    sentBy: string;
    sentAt: number;
    to: string[];
  }>;
  activity: Array<{
    id: string;
    type: string;
    actorName: string;
    summary: string;
    createdAt: number;
  }>;
  messages: Array<{
    id: string;
    body: string;
    authorId: string;
    authorName: string;
    createdAt: number;
  }>;
  files: Array<{
    id: string;
    name: string;
    ownerId: string;
    contentType: string;
    size: number;
    visibility: string;
    sharedWith: string[];
    createdAt: number;
  }>;
};

export function buildTableExport(input: {
  table: TableDoc;
  members: MemberDoc[];
  notices: NoticeDoc[];
  activity: ActivityDoc[];
  files: FileDoc[];
  messages?: ChatMessage[];
  exportedAt?: number;
}): TableExportPayload {
  return {
    exportedAt: input.exportedAt ?? Date.now(),
    table: {
      id: input.table.id,
      name: input.table.name,
      joinCode: input.table.joinCode,
      seatLimit: input.table.seatLimit,
      joinPolicy: joinPolicyLabel(input.table.joinPolicy),
      memberCount: input.table.memberCount,
      archived: input.table.archived,
      archivedAt: input.table.archivedAt,
      createdAt: input.table.createdAt,
    },
    members: input.members.map((member) => ({
      uid: member.uid,
      displayName: member.displayName,
      role: member.role,
      seatNote: member.seatNote,
      email: member.email,
      joinedAt: member.joinedAt,
    })),
    notices: input.notices.map((notice) => ({
      id: notice.id,
      subject: notice.subject,
      body: notice.body,
      sentBy: notice.sentBy,
      sentAt: notice.sentAt,
      to: [...notice.to],
    })),
    activity: input.activity.map((item) => ({
      id: item.id,
      type: item.type,
      actorName: item.actorName,
      summary: item.summary,
      createdAt: item.createdAt,
    })),
    messages: (input.messages ?? []).map((message) => ({
      id: message.id,
      body: message.body,
      authorId: message.authorId,
      authorName: message.authorName,
      createdAt: message.createdAt,
    })),
    files: input.files.map((file) => ({
      id: file.id,
      name: file.name,
      ownerId: file.ownerId,
      contentType: file.contentType,
      size: file.size,
      visibility: file.visibility,
      sharedWith: [...file.sharedWith],
      createdAt: file.createdAt,
    })),
  };
}

export function tableExportJson(payload: TableExportPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function tableExportFilename(table: Pick<TableDoc, "name" | "id">, exportedAt = Date.now()): string {
  const stamp = new Date(exportedAt).toISOString().slice(0, 10);
  const safe = table.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${safe || "table"}-${table.id.slice(0, 8)}-${stamp}.json`;
}

export function downloadTextFile(filename: string, contents: string, mime = "application/json"): void {
  if (typeof document === "undefined") {
    throw new Error("Downloads only work in the browser.");
  }
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
