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
  joinedAt: number;
};
