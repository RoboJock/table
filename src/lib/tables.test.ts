import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMember,
  buildTable,
  canEditSeat,
  canManageTable,
  cleanDisplayName,
  cleanSeatNote,
  cleanTableName,
  cleanUid,
  memberPayload,
  sortMembers,
  tablePayload,
} from "./tables";

describe("table helpers", () => {
  it("trims and bounds table names", () => {
    assert.equal(cleanTableName("  Game night  "), "Game night");
    assert.throws(() => cleanTableName(""));
    assert.throws(() => cleanTableName("x".repeat(41)));
  });

  it("builds table and member payloads without ids", () => {
    const table = buildTable({ id: "abc", name: "Campaign", ownerId: "u1", createdAt: 10 });
    assert.deepEqual(tablePayload(table), {
      name: "Campaign",
      ownerId: "u1",
      createdAt: 10,
    });
    const member = buildMember({
      uid: "u1",
      displayName: "Ada",
      role: "owner",
      seatNote: "DM",
      joinedAt: 11,
    });
    assert.deepEqual(memberPayload(member), {
      displayName: "Ada",
      role: "owner",
      seatNote: "DM",
      joinedAt: 11,
    });
  });

  it("keeps seat edits to the signed-in member", () => {
    assert.equal(canEditSeat("a", "a"), true);
    assert.equal(canEditSeat("a", "b"), false);
    assert.equal(canManageTable("owner"), true);
    assert.equal(canManageTable("member"), false);
  });

  it("sorts owners first", () => {
    const sorted = sortMembers([
      buildMember({ uid: "2", displayName: "Zoe", role: "member" }),
      buildMember({ uid: "1", displayName: "Ada", role: "owner" }),
      buildMember({ uid: "3", displayName: "Bea", role: "member" }),
    ]);
    assert.deepEqual(
      sorted.map((member) => member.uid),
      ["1", "3", "2"],
    );
  });

  it("validates seat notes, display names, and uids", () => {
    assert.equal(cleanSeatNote("  hello  "), "hello");
    assert.throws(() => cleanSeatNote("x".repeat(501)));
    assert.equal(cleanDisplayName("  Sam  "), "Sam");
    assert.equal(cleanUid("abcDEF123"), "abcDEF123");
    assert.throws(() => cleanUid("bad uid"));
  });
});
