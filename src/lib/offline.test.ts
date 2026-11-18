import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectionMessage } from "./offline";

describe("offline connection copy", () => {
  it("explains offline editing and sync", () => {
    assert.match(connectionMessage({ online: false, synced: false }) ?? "", /offline/i);
    assert.match(connectionMessage({ online: true, synced: false }) ?? "", /Syncing/i);
    assert.equal(connectionMessage({ online: true, synced: true }), null);
  });
});
