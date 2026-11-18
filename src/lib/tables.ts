import type { JoinCodeDoc, JoinPolicy, MemberDoc, MemberRole, NoticeDoc, TableDoc } from "./types";

/** Avoid ambiguous characters in spoken / typed join codes. */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function cleanJoinCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    throw new Error("Join codes are 6 letters or numbers.");
  }
  return normalized;
}

export function newJoinCode(): string {
  const bytes =
    typeof crypto !== "undefined" && "getRandomValues" in crypto
      ? crypto.getRandomValues(new Uint8Array(6))
      : Uint8Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  return Array.from(bytes, (byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length]).join("");
}

export function joinCodePayload(table: TableDoc): Omit<JoinCodeDoc, "code"> {
  return {
    tableId: table.id,
    name: table.name,
    seatLimit: table.seatLimit,
    memberCount: table.memberCount,
    joinPolicy: table.joinPolicy,
    ownerId: table.ownerId,
    archived: table.archived,
  };
}

export function canJoinWithCode(
  table: Pick<TableDoc, "memberCount" | "seatLimit" | "archived">,
  alreadyMember: boolean,
): boolean {
  if (alreadyMember) return false;
  if (table.archived) return false;
  return seatsRemaining(table as TableDoc) > 0;
}

export function isTableArchived(table: Pick<TableDoc, "archived">): boolean {
  return table.archived === true;
}

export function partitionOwnedTables(tables: TableDoc[]): {
  active: TableDoc[];
  archived: TableDoc[];
} {
  const active: TableDoc[] = [];
  const archived: TableDoc[] = [];
  for (const table of tables) {
    if (table.archived) archived.push(table);
    else active.push(table);
  }
  active.sort((a, b) => b.createdAt - a.createdAt);
  archived.sort((a, b) => (b.archivedAt || b.createdAt) - (a.archivedAt || a.createdAt));
  return { active, archived };
}

export function cleanTableName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new Error("Use a table name between 1 and 40 characters.");
  }
  return trimmed;
}

export function cleanDisplayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new Error("Use a display name between 1 and 40 characters.");
  }
  return trimmed;
}

export function cleanSeatNote(note: string): string {
  const trimmed = note.trim();
  if (trimmed.length > 500) {
    throw new Error("Seat notes can be at most 500 characters.");
  }
  return trimmed;
}

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

export function cleanUid(uid: string): string {
  const trimmed = uid.trim();
  if (!/^[A-Za-z0-9]{6,128}$/.test(trimmed)) {
    throw new Error("That does not look like an account id.");
  }
  return trimmed;
}

export function cleanSeatLimit(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 40) {
    throw new Error("Choose a seat limit between 1 and 40.");
  }
  return value;
}

export function cleanJoinPolicy(value: string): JoinPolicy {
  if (value === "inviteOnly" || value === "firstComeFirstServe") return value;
  throw new Error("Choose Invite only or First come, first serve.");
}

export function joinPolicyLabel(policy: JoinPolicy): string {
  return policy === "inviteOnly" ? "Invite only" : "First come, first serve";
}

export function seatsRemaining(table: TableDoc): number {
  return Math.max(0, table.seatLimit - table.memberCount);
}

export function canJoinFirstCome(table: TableDoc, alreadyMember: boolean): boolean {
  if (alreadyMember) return false;
  if (table.joinPolicy !== "firstComeFirstServe") return false;
  return seatsRemaining(table) > 0;
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

export function newTableId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function buildTable(input: {
  id: string;
  name: string;
  ownerId: string;
  seatLimit: number;
  joinPolicy: JoinPolicy;
  joinCode?: string;
  memberCount?: number;
  archived?: boolean;
  archivedAt?: number;
  createdAt?: number;
}): TableDoc {
  const seatLimit = cleanSeatLimit(input.seatLimit);
  const memberCount = input.memberCount ?? 1;
  if (memberCount < 1 || memberCount > seatLimit) {
    throw new Error("Member count must fit inside the seat limit.");
  }
  const archived = input.archived === true;
  const archivedAt = archived ? (input.archivedAt ?? Date.now()) : 0;
  return {
    id: input.id,
    name: cleanTableName(input.name),
    ownerId: input.ownerId,
    joinCode: cleanJoinCode(input.joinCode ?? newJoinCode()),
    seatLimit,
    joinPolicy: cleanJoinPolicy(input.joinPolicy),
    memberCount,
    archived,
    archivedAt,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function buildMember(input: {
  uid: string;
  displayName: string;
  role: MemberRole;
  seatNote?: string;
  email?: string;
  noticesMuted?: boolean;
  joinedAt?: number;
}): MemberDoc {
  return {
    uid: input.uid,
    displayName: cleanDisplayName(input.displayName),
    role: input.role,
    seatNote: cleanSeatNote(input.seatNote ?? ""),
    email: cleanEmail(input.email ?? ""),
    noticesMuted: input.noticesMuted === true,
    joinedAt: input.joinedAt ?? Date.now(),
  };
}

export function buildNotice(input: {
  id: string;
  subject: string;
  body: string;
  sentBy: string;
  to: string[];
  sentAt?: number;
}): NoticeDoc {
  return {
    id: input.id,
    subject: cleanNoticeSubject(input.subject),
    body: cleanNoticeBody(input.body),
    sentBy: input.sentBy,
    sentAt: input.sentAt ?? Date.now(),
    to: input.to.map((address) => cleanEmail(address)).filter(Boolean),
  };
}

export function tablePayload(table: TableDoc): Omit<TableDoc, "id"> {
  return {
    name: table.name,
    ownerId: table.ownerId,
    joinCode: table.joinCode,
    seatLimit: table.seatLimit,
    joinPolicy: table.joinPolicy,
    memberCount: table.memberCount,
    archived: table.archived,
    archivedAt: table.archivedAt,
    createdAt: table.createdAt,
  };
}

export function tableFieldsForCountBump(table: TableDoc, memberCount: number): Omit<TableDoc, "id"> {
  return {
    name: table.name,
    ownerId: table.ownerId,
    joinCode: table.joinCode,
    seatLimit: table.seatLimit,
    joinPolicy: table.joinPolicy,
    memberCount,
    archived: table.archived,
    archivedAt: table.archivedAt,
    createdAt: table.createdAt,
  };
}

export function memberPayload(member: MemberDoc): Omit<MemberDoc, "uid"> {
  return {
    displayName: member.displayName,
    role: member.role,
    seatNote: member.seatNote,
    email: member.email,
    noticesMuted: member.noticesMuted,
    joinedAt: member.joinedAt,
  };
}

export function noticePayload(notice: NoticeDoc): Omit<NoticeDoc, "id"> {
  return {
    subject: notice.subject,
    body: notice.body,
    sentBy: notice.sentBy,
    sentAt: notice.sentAt,
    to: notice.to,
  };
}

export function canEditSeat(viewerUid: string, memberUid: string): boolean {
  return viewerUid === memberUid;
}

export function canManageTable(role: MemberRole | null | undefined): boolean {
  return role === "owner";
}

export function canSendNotice(role: MemberRole | null | undefined): boolean {
  return role === "owner" || role === "member";
}

export function memberEmailsForNotice(members: MemberDoc[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const member of members) {
    if (member.noticesMuted) continue;
    const address = cleanEmail(member.email || "");
    if (!address || seen.has(address)) continue;
    seen.add(address);
    list.push(address);
  }
  return list;
}

export function sortMembers(members: MemberDoc[]): MemberDoc[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function sortNotices(notices: NoticeDoc[]): NoticeDoc[] {
  return [...notices].sort((a, b) => b.sentAt - a.sentAt);
}

const RECENT_KEY = "table-recent-v1";

export function readRecentTableIds(owner: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "") as Record<string, unknown>;
    const list = parsed?.[owner];
    if (!Array.isArray(list)) return [];
    return list.filter((item): item is string => typeof item === "string").slice(0, 12);
  } catch {
    return [];
  }
}

export function rememberTableId(owner: string, tableId: string) {
  if (typeof localStorage === "undefined") return;
  const next = [tableId, ...readRecentTableIds(owner).filter((id) => id !== tableId)].slice(0, 12);
  let parsed: Record<string, string[]> = {};
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "");
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (Array.isArray(item)) {
          parsed[key] = item.filter((entry): entry is string => typeof entry === "string");
        }
      }
    }
  } catch {
    parsed = {};
  }
  parsed[owner] = next;
  localStorage.setItem(RECENT_KEY, JSON.stringify(parsed));
}
