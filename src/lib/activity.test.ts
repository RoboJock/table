import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildActivity, sortActivity } from "./activity";
import { canJoinWithCode, cleanJoinCode, newJoinCode } from "./tables";

describe("activity and join codes", () => {
  it("builds and sorts activity", () => {
    const newer = buildActivity({
      type: "joined",
      actorId: "u1",
      actorName: "Ada",
      summary: "Ada took a seat.",
      createdAt: 20,
    });
    const older = buildActivity({
      type: "created",
      actorId: "u1",
      actorName: "Ada",
      summary: "Ada created this table.",
      createdAt: 10,
    });
    assert.equal(sortActivity([older, newer])[0]?.id, newer.id);
  });

  it("normalizes join codes", () => {
    assert.equal(cleanJoinCode(" ab-c123 "), "ABC123");
    assert.throws(() => cleanJoinCode("short"));
    assert.equal(newJoinCode().length, 6);
    assert.equal(canJoinWithCode({ memberCount: 2, seatLimit: 4 }, false), true);
    assert.equal(canJoinWithCode({ memberCount: 4, seatLimit: 4 }, false), false);
  });
});
