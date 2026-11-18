import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMember,
  buildNotice,
  buildTable,
  canEditSeat,
  canManageTable,
  canSendNotice,
  cleanDisplayName,
  cleanEmail,
  cleanSeatNote,
  cleanTableName,
  cleanUid,
  memberEmailsForNotice,
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
      email: "Ada@Example.com",
      joinedAt: 11,
    });
    assert.deepEqual(memberPayload(member), {
      displayName: "Ada",
      role: "owner",
      seatNote: "DM",
      email: "ada@example.com",
      joinedAt: 11,
    });
  });

  it("keeps seat edits to the signed-in member", () => {
    assert.equal(canEditSeat("a", "a"), true);
    assert.equal(canEditSeat("a", "b"), false);
    assert.equal(canManageTable("owner"), true);
    assert.equal(canManageTable("member"), false);
    assert.equal(canSendNotice("member"), true);
    assert.equal(canSendNotice(null), false);
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

  it("validates seat notes, display names, emails, and uids", () => {
    assert.equal(cleanSeatNote("  hello  "), "hello");
    assert.throws(() => cleanSeatNote("x".repeat(501)));
    assert.equal(cleanDisplayName("  Sam  "), "Sam");
    assert.equal(cleanEmail("Sam@Example.com"), "sam@example.com");
    assert.equal(cleanEmail(""), "");
    assert.throws(() => cleanEmail("bad"));
    assert.equal(cleanUid("abcDEF123"), "abcDEF123");
    assert.throws(() => cleanUid("bad uid"));
  });

  it("collects notice recipients and builds notice docs", () => {
    const members = [
      buildMember({ uid: "1", displayName: "Ada", role: "owner", email: "ada@example.com" }),
      buildMember({ uid: "2", displayName: "Bea", role: "member", email: "" }),
      buildMember({ uid: "3", displayName: "Cara", role: "member", email: "cara@example.com" }),
    ];
    assert.deepEqual(memberEmailsForNotice(members), ["ada@example.com", "cara@example.com"]);
    const notice = buildNotice({
      id: "n1",
      subject: "Bring dice",
      body: "See you at 7.",
      sentBy: "1",
      to: ["ada@example.com"],
      sentAt: 12,
    });
    assert.equal(notice.subject, "Bring dice");
    assert.deepEqual(notice.to, ["ada@example.com"]);
  });
});
