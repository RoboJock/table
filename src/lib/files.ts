import type { FileDoc, FileVisibility, MemberDoc } from "./types";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export type AllowedFileType = (typeof ALLOWED_FILE_TYPES)[number];

export function cleanFileName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new Error("Use a file name between 1 and 80 characters.");
  }
  return trimmed;
}

export function cleanFileVisibility(value: string): FileVisibility {
  if (value === "private" || value === "table" || value === "shared") return value;
  throw new Error("Choose who can see this file.");
}

export function fileVisibilityLabel(visibility: FileVisibility): string {
  if (visibility === "private") return "Only you";
  if (visibility === "table") return "Everyone at this table";
  return "Shared with selected people";
}

export function assertAllowedFile(file: { name: string; type: string; size: number }): {
  name: string;
  contentType: AllowedFileType;
  size: number;
} {
  const name = cleanFileName(file.name);
  if (!ALLOWED_FILE_TYPES.includes(file.type as AllowedFileType)) {
    throw new Error("Use an image (JPEG, PNG, WebP, GIF) or a PDF.");
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new Error("Files must be at most 5 MB.");
  }
  return { name, contentType: file.type as AllowedFileType, size: file.size };
}

export function cleanSharedWith(uids: string[], uploaderId: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of uids) {
    const uid = raw.trim();
    if (!uid || uid === uploaderId || seen.has(uid)) continue;
    if (!/^[A-Za-z0-9]{6,128}$/.test(uid)) {
      throw new Error("That share list has an invalid account id.");
    }
    seen.add(uid);
    list.push(uid);
    if (list.length > 40) throw new Error("You can share with at most 40 people.");
  }
  return list;
}

export function buildFileDoc(input: {
  id: string;
  name: string;
  ownerId: string;
  contentType: string;
  size: number;
  visibility: FileVisibility;
  sharedWith?: string[];
  createdAt?: number;
}): FileDoc {
  const visibility = cleanFileVisibility(input.visibility);
  const sharedWith =
    visibility === "shared" ? cleanSharedWith(input.sharedWith ?? [], input.ownerId) : [];
  if (visibility === "shared" && sharedWith.length === 0) {
    throw new Error("Pick at least one person to share with, or choose another option.");
  }
  const checked = assertAllowedFile({
    name: input.name,
    type: input.contentType,
    size: input.size,
  });
  return {
    id: input.id,
    name: checked.name,
    ownerId: input.ownerId,
    contentType: checked.contentType,
    size: checked.size,
    visibility,
    sharedWith,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function filePayload(file: FileDoc): Omit<FileDoc, "id"> {
  return {
    name: file.name,
    ownerId: file.ownerId,
    contentType: file.contentType,
    size: file.size,
    visibility: file.visibility,
    sharedWith: file.sharedWith,
    createdAt: file.createdAt,
  };
}

export function canViewFile(viewerUid: string, file: FileDoc): boolean {
  if (file.ownerId === viewerUid) return true;
  if (file.visibility === "private") return false;
  if (file.visibility === "table") return true;
  return file.sharedWith.includes(viewerUid);
}

export function canManageFile(viewerUid: string, file: FileDoc): boolean {
  return file.ownerId === viewerUid;
}

export function storagePathForFile(tableId: string, fileId: string): string {
  return `tables/${tableId}/files/${fileId}`;
}

export function newFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function sortFiles(files: FileDoc[]): FileDoc[] {
  return [...files].sort((a, b) => b.createdAt - a.createdAt);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function memberLabel(members: MemberDoc[], uid: string): string {
  return members.find((member) => member.uid === uid)?.displayName ?? "Member";
}
