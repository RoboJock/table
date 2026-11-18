import type { PresenceDoc } from "./types";

/** How often the open room writes “I’m here”. */
export const PRESENCE_HEARTBEAT_MS = 20_000;

/** Heartbeats older than this count as gone. */
export const PRESENCE_FRESH_MS = 45_000;

export function buildPresence(input: {
  uid: string;
  displayName: string;
  lastSeen?: number;
}): PresenceDoc {
  const displayName = input.displayName.trim() || "Member";
  if (displayName.length > 40) {
    throw new Error("Display names can be at most 40 characters.");
  }
  return {
    uid: input.uid,
    displayName,
    lastSeen: input.lastSeen ?? Date.now(),
  };
}

export function presencePayload(presence: PresenceDoc): Omit<PresenceDoc, "uid"> {
  return {
    displayName: presence.displayName,
    lastSeen: presence.lastSeen,
  };
}

export function isPresenceFresh(presence: PresenceDoc, now = Date.now()): boolean {
  return now - presence.lastSeen <= PRESENCE_FRESH_MS;
}

export function filterPresent(rows: PresenceDoc[], now = Date.now()): PresenceDoc[] {
  return rows
    .filter((row) => isPresenceFresh(row, now))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function presenceLabel(count: number): string {
  if (count <= 0) return "Nobody else is here right now.";
  if (count === 1) return "1 person here now";
  return `${count} people here now`;
}
