import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canChangeOwnerId,
  canPromoteToOwner,
  canUpdateSeatNote,
  signedOutCanRead,
  signedOutCanSendNotice,
  strangerCanReadTable,
  strangerCanSendNotice,
} from "./permissions";
import { buildMember, buildTable } from "./tables";

describe("permission brief deny cases", () => {
  const table = buildTable({
    id: "t1",
    name: "Night",
    ownerId: "owner1",
    seatLimit: 4,
    joinPolicy: "inviteOnly",
    createdAt: 1,
  });
  const members = [
    buildMember({ uid: "owner1", displayName: "Owner", role: "owner" }),
    buildMember({ uid: "member2", displayName: "Member", role: "member" }),
  ];

  it("denies signed-in non-members even when they know the id", () => {
    assert.equal(strangerCanReadTable("stranger", table, members), false);
    assert.equal(strangerCanReadTable("member2", table, members), true);
  });

  it("denies editing another member seat", () => {
    assert.equal(canUpdateSeatNote("member2", "owner1", "member"), false);
    assert.equal(canUpdateSeatNote("member2", "member2", "member"), true);
  });

  it("denies changing ownerId or self-promotion", () => {
    assert.equal(canChangeOwnerId("member2", table, "member2"), false);
    assert.equal(canChangeOwnerId("owner1", table, "owner1"), true);
    assert.equal(
      canPromoteToOwner("member2", members[1], "owner"),
      false,
    );
  });

  it("denies signed-out reads", () => {
    assert.equal(signedOutCanRead(), false);
    assert.equal(strangerCanReadTable(null, table, members), false);
  });

  it("denies notice sends for strangers and signed-out callers", () => {
    assert.equal(signedOutCanSendNotice(), false);
    assert.equal(strangerCanSendNotice(null, members), false);
    assert.equal(strangerCanSendNotice("stranger", members), false);
    assert.equal(strangerCanSendNotice("member2", members), true);
  });
});
