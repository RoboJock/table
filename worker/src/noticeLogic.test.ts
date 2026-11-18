import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNoticeEmail,
  cleanEmail,
  cleanNoticeBody,
  cleanNoticeSubject,
  collectRecipientEmails,
} from "./noticeLogic.ts";

describe("noticeLogic", () => {
  it("collects unique valid member emails", () => {
    assert.deepEqual(
      collectRecipientEmails([
        { uid: "1", email: "Ada@Example.com" },
        { uid: "2", email: "ada@example.com" },
        { uid: "3", email: "" },
        { uid: "4", email: "bea@example.com" },
      ]),
      ["ada@example.com", "bea@example.com"],
    );
  });

  it("validates notice fields", () => {
    assert.equal(cleanNoticeSubject("  Hello  "), "Hello");
    assert.throws(() => cleanNoticeSubject(""));
    assert.throws(() => cleanNoticeBody(""));
    assert.equal(cleanEmail("Sam@Example.com"), "sam@example.com");
    assert.throws(() => cleanEmail("not-an-email"));
  });

  it("builds a plain email payload", () => {
    const mail = buildNoticeEmail({
      tableName: "Game night",
      subject: "Bring snacks",
      body: "Starts at 7.",
      senderName: "Ada",
    });
    assert.equal(mail.subject, "Bring snacks");
    assert.match(mail.text, /Game night/);
    assert.match(mail.html, /Starts at 7/);
  });
});
