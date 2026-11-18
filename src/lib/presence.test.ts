import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPresence,
  filterPresent,
  isPresenceFresh,
  presenceLabel,
  PRESENCE_FRESH_MS,
} from "./presence";

describe("presence helpers", () => {
  it("treats recent heartbeats as present", () => {
    const now = 1_000_000;
    const fresh = buildPresence({ uid: "a", displayName: "Ada", lastSeen: now - 1_000 });
    const stale = buildPresence({
      uid: "b",
      displayName: "Bea",
      lastSeen: now - PRESENCE_FRESH_MS - 1,
    });
    assert.equal(isPresenceFresh(fresh, now), true);
    assert.equal(isPresenceFresh(stale, now), false);
    assert.deepEqual(
      filterPresent([stale, fresh], now).map((row) => row.uid),
      ["a"],
    );
  });

  it("labels the here-now count", () => {
    assert.match(presenceLabel(0), /Nobody/i);
    assert.match(presenceLabel(1), /1 person/i);
    assert.match(presenceLabel(3), /3 people/i);
  });
});
