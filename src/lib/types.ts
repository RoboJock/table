export type MemberRole = "owner" | "member";

export type AppUser = {
  id: string;
  name: string;
  email: string;
};

export type TableDoc = {
  id: string;
  name: string;
  ownerId: string;
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
