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
  /** Max people at the table, including the owner. */
  seatLimit: number;
  joinPolicy: JoinPolicy;
  /** Living member count; kept in sync on join/leave/invite/remove. */
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
