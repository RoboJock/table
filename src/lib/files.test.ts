import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAllowedFile,
  buildFileDoc,
  canManageFile,
  canViewFile,
  cleanSharedWith,
  fileVisibilityLabel,
  MAX_FILE_BYTES,
} from "./files";

describe("file helpers", () => {
  it("accepts images and PDFs under 5 MB", () => {
    assert.equal(assertAllowedFile({ name: "map.png", type: "image/png", size: 1000 }).contentType, "image/png");
    assert.throws(() => assertAllowedFile({ name: "x.bin", type: "application/octet-stream", size: 10 }));
    assert.throws(() => assertAllowedFile({ name: "big.pdf", type: "application/pdf", size: MAX_FILE_BYTES + 1 }));
  });

  it("builds visibility and share lists", () => {
    const file = buildFileDoc({
      id: "f1",
      name: "handout.pdf",
      ownerId: "owner1",
      contentType: "application/pdf",
      size: 1200,
      visibility: "shared",
      sharedWith: ["member2", "owner1", "member2"],
    });
    assert.deepEqual(file.sharedWith, ["member2"]);
    assert.equal(fileVisibilityLabel("private"), "Only you");
    assert.throws(() =>
      buildFileDoc({
        id: "f2",
        name: "secret.pdf",
        ownerId: "owner1",
        contentType: "application/pdf",
        size: 10,
        visibility: "shared",
        sharedWith: [],
      }),
    );
    assert.deepEqual(cleanSharedWith(["member2", "member2", "owner"], "owner"), ["member2"]);
  });

  it("gates who can view or manage a file", () => {
    const privateFile = buildFileDoc({
      id: "1",
      name: "a.png",
      ownerId: "owner1",
      contentType: "image/png",
      size: 10,
      visibility: "private",
    });
    const tableFile = { ...privateFile, visibility: "table" as const };
    const sharedFile = {
      ...privateFile,
      visibility: "shared" as const,
      sharedWith: ["member2"],
    };
    assert.equal(canViewFile("owner1", privateFile), true);
    assert.equal(canViewFile("member2", privateFile), false);
    assert.equal(canViewFile("member2", tableFile), true);
    assert.equal(canViewFile("member2", sharedFile), true);
    assert.equal(canViewFile("member3", sharedFile), false);
    assert.equal(canManageFile("owner1", privateFile), true);
    assert.equal(canManageFile("member2", privateFile), false);
  });
});
