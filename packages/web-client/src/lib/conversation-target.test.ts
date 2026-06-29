import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { buildConversationTarget } from "./conversation-target.js";

function thread(
	overrides: Partial<RemitImapThreadMessageResponse> = {},
): RemitImapThreadMessageResponse {
	return {
		messageId: "m1",
		threadId: "t1",
		mailboxId: "mb1",
		subject: "Loaded subject",
		isRead: false,
		...overrides,
	} as RemitImapThreadMessageResponse;
}

describe("buildConversationTarget", () => {
	test("prefers the loaded thread, carrying its display fields", () => {
		const authenticity = { dkimMismatch: true, fromDomain: "example.com" };
		const target = buildConversationTarget(thread({ authenticity }), {
			messageId: "m1",
			threadId: "ignored",
			mailboxId: "ignored",
		});
		assert.deepEqual(target, {
			threadId: "t1",
			mailboxId: "mb1",
			subject: "Loaded subject",
			messageId: "m1",
			authenticity,
		});
	});

	// The bug: a tapped semantic "Related" hit's message isn't in the loaded list,
	// so there is no thread to resolve — it must still open from the URL hints.
	test("falls back to the URL thread + mailbox when no thread is loaded", () => {
		const target = buildConversationTarget(undefined, {
			messageId: "m9",
			threadId: "t9",
			mailboxId: "mb9",
		});
		assert.deepEqual(target, {
			threadId: "t9",
			mailboxId: "mb9",
			messageId: "m9",
		});
	});

	test("returns undefined when the message is cleared (Back pressed)", () => {
		const target = buildConversationTarget(undefined, {
			messageId: undefined,
			threadId: "t9",
			mailboxId: "mb9",
		});
		assert.equal(target, undefined);
	});

	test("returns undefined without a threadId to open", () => {
		const target = buildConversationTarget(undefined, {
			messageId: "m9",
			threadId: undefined,
			mailboxId: "mb9",
		});
		assert.equal(target, undefined);
	});
});
