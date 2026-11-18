import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChatMessage, canDeleteChat, cleanChatBody, sortChat } from "./chat";

describe("chat helpers", () => {
  it("trims messages and sorts oldest first", () => {
    assert.equal(cleanChatBody("  hello  "), "hello");
    assert.throws(() => cleanChatBody(""));
    assert.throws(() => cleanChatBody("x".repeat(501)));
    const later = buildChatMessage({
      body: "later",
      authorId: "a",
      authorName: "Ada",
      createdAt: 20,
    });
    const earlier = buildChatMessage({
      body: "earlier",
      authorId: "b",
      authorName: "Bea",
      createdAt: 10,
    });
    assert.equal(sortChat([later, earlier])[0]?.body, "earlier");
  });

  it("lets the author or the owner remove a message", () => {
    const message = buildChatMessage({
      body: "hi",
      authorId: "member",
      authorName: "Bea",
    });
    assert.equal(canDeleteChat("member", "member", message), true);
    assert.equal(canDeleteChat("owner", "owner", message), true);
    assert.equal(canDeleteChat("other", "member", message), false);
  });
});
