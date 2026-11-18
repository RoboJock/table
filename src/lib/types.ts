export type MemberRole = "owner" | "member";

export type JoinPolicy = "inviteOnly" | "firstComeFirstServe";

export type AppUser = {
  id: string;
  name: string;
  email: string;
};

export type TableDoc = {
  id: string;
  name: string;
  ownerId: string;
  /** Short code people use to find and join this table. */
  joinCode: string;
  /** Max people at the table, including the owner. */
  seatLimit: number;
  joinPolicy: JoinPolicy;
  /** Living member count; kept in sync on join/leave/remove. */
  memberCount: number;
  createdAt: number;
};

export type MemberDoc = {
  uid: string;
  displayName: string;
  role: MemberRole;
  seatNote: string;
  /** Inbox address for table notices. Empty until the member saves one. */
  email: string;
  joinedAt: number;
};

export type NoticeDoc = {
  id: string;
  subject: string;
  body: string;
  sentBy: string;
  sentAt: number;
  to: string[];
};

export type FileVisibility = "private" | "table" | "shared";

export type FileDoc = {
  id: string;
  name: string;
  ownerId: string;
  contentType: string;
  size: number;
  visibility: FileVisibility;
  sharedWith: string[];
  createdAt: number;
};

export type ActivityType =
  | "created"
  | "joined"
  | "left"
  | "removed"
  | "notice"
  | "settings"
  | "code_rotated";

export type ActivityDoc = {
  id: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  summary: string;
  createdAt: number;
};

/** Public peek fields stored under joinCodes/{code}. */
export type JoinCodeDoc = {
  code: string;
  tableId: string;
  name: string;
  seatLimit: number;
  memberCount: number;
  joinPolicy: JoinPolicy;
  ownerId: string;
};

/** Who currently has this table open. Stale rows age out client-side. */
export type PresenceDoc = {
  uid: string;
  displayName: string;
  lastSeen: number;
};
