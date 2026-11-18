import type { ActivityDoc, ActivityType } from "./types";

export function cleanActivitySummary(summary: string): string {
  const trimmed = summary.trim().replace(/\s+/g, " ");
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new Error("Activity notes must be between 1 and 200 characters.");
  }
  return trimmed;
}

export function newActivityId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  }
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function buildActivity(input: {
  id?: string;
  type: ActivityType;
  actorId: string;
  actorName: string;
  summary: string;
  createdAt?: number;
}): ActivityDoc {
  return {
    id: input.id ?? newActivityId(),
    type: input.type,
    actorId: input.actorId,
    actorName: input.actorName.trim() || "Member",
    summary: cleanActivitySummary(input.summary),
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function activityPayload(activity: ActivityDoc): Omit<ActivityDoc, "id"> {
  return {
    type: activity.type,
    actorId: activity.actorId,
    actorName: activity.actorName,
    summary: activity.summary,
    createdAt: activity.createdAt,
  };
}

export function sortActivity(items: ActivityDoc[]): ActivityDoc[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

export function formatActivityTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
