import type { ChatMessage, MemberRole } from "./types";

export const MAX_CHAT_LENGTH = 500;

export function cleanChatBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_CHAT_LENGTH) {
    throw new Error("Use a message between 1 and 500 characters.");
  }
  return trimmed;
}

export function newChatId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function buildChatMessage(input: {
  id?: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt?: number;
}): ChatMessage {
  const authorName = input.authorName.trim() || "Member";
  if (authorName.length > 40) {
    throw new Error("Display names can be at most 40 characters.");
  }
  return {
    id: input.id ?? newChatId(),
    body: cleanChatBody(input.body),
    authorId: input.authorId,
    authorName,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function chatPayload(message: ChatMessage): Omit<ChatMessage, "id"> {
  return {
    body: message.body,
    authorId: message.authorId,
    authorName: message.authorName,
    createdAt: message.createdAt,
  };
}

export function sortChat(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.createdAt - b.createdAt);
}

export function canDeleteChat(
  viewerUid: string,
  role: MemberRole | null | undefined,
  message: Pick<ChatMessage, "authorId">,
): boolean {
  if (message.authorId === viewerUid) return true;
  return role === "owner";
}
