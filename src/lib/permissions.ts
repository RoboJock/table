import type { MemberDoc, MemberRole, TableDoc } from "./types";

/** Pure stand-ins for the Deny cases in the permission brief. */

export function strangerCanReadTable(
  viewerUid: string | null,
  table: TableDoc,
  members: MemberDoc[],
): boolean {
  if (!viewerUid) return false;
  return members.some((member) => member.uid === viewerUid);
}

export function canUpdateSeatNote(
  viewerUid: string,
  targetUid: string,
  viewerRole: MemberRole | null,
): boolean {
  if (!viewerRole) return false;
  return viewerUid === targetUid;
}

export function canChangeOwnerId(
  viewerUid: string,
  table: TableDoc,
  nextOwnerId: string,
): boolean {
  if (nextOwnerId === table.ownerId) return true;
  return false;
}

export function canPromoteToOwner(
  viewerUid: string,
  member: MemberDoc,
  nextRole: MemberRole,
): boolean {
  if (nextRole === member.role) return true;
  if (viewerUid === member.uid && member.role === "member" && nextRole === "owner") {
    return false;
  }
  return false;
}

export function signedOutCanRead(): boolean {
  return false;
}
