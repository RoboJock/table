import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTableExport, tableExportFilename, tableExportJson } from "./export";
import { buildActivity } from "./activity";
import { buildMember, buildTable, canJoinWithCode, partitionOwnedTables } from "./tables";

describe("export and archive helpers", () => {
  it("builds a downloadable export payload", () => {
    const table = buildTable({
      id: "table123456",
      name: "Friday Night",
      ownerId: "owner1",
      seatLimit: 4,
      joinPolicy: "inviteOnly",
      joinCode: "ABC123",
      createdAt: 10,
    });
    const payload = buildTableExport({
      table,
      members: [buildMember({ uid: "owner1", displayName: "Ada", role: "owner", joinedAt: 10 })],
      notices: [],
      activity: [
        buildActivity({
          type: "created",
          actorId: "owner1",
          actorName: "Ada",
          summary: "Ada created this table.",
          createdAt: 10,
        }),
      ],
      files: [],
      exportedAt: 20,
    });
    assert.equal(payload.table.name, "Friday Night");
    assert.equal(payload.members.length, 1);
    assert.match(tableExportJson(payload), /"Friday Night"/);
    assert.match(tableExportFilename(table, 20), /^friday-night-table123-1970-01-01\.json$/);
  });

  it("partitions archived tables and blocks joins while archived", () => {
    const active = buildTable({
      id: "a1",
      name: "Active",
      ownerId: "o",
      seatLimit: 3,
      joinPolicy: "inviteOnly",
      joinCode: "AAAAAA",
    });
    const archived = buildTable({
      id: "a2",
      name: "Old",
      ownerId: "o",
      seatLimit: 3,
      joinPolicy: "inviteOnly",
      joinCode: "BBBBBB",
      archived: true,
      archivedAt: 99,
    });
    const parts = partitionOwnedTables([archived, active]);
    assert.equal(parts.active[0]?.id, "a1");
    assert.equal(parts.archived[0]?.id, "a2");
    assert.equal(canJoinWithCode(active, false), true);
    assert.equal(canJoinWithCode(archived, false), false);
  });
});
