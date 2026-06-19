import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveSimilarState, resolveSpamAction } from "./IntelligencePane";

const junkId = "junk-mailbox";
const inboxId = "inbox-mailbox";

describe("resolveSpamAction (#594)", () => {
	test("offers Not spam when the message is in Junk and Inbox is resolved", () => {
		assert.equal(
			resolveSpamAction({
				mailboxId: junkId,
				junkMailboxId: junkId,
				inboxMailboxId: inboxId,
			}),
			"notSpam",
		);
	});

	test("offers Mark spam when the message is outside Junk and Junk is resolved", () => {
		assert.equal(
			resolveSpamAction({
				mailboxId: inboxId,
				junkMailboxId: junkId,
				inboxMailboxId: inboxId,
			}),
			"markSpam",
		);
	});

	test("offers nothing when the move source mailbox is unknown", () => {
		assert.equal(
			resolveSpamAction({
				mailboxId: undefined,
				junkMailboxId: junkId,
				inboxMailboxId: inboxId,
			}),
			null,
		);
	});

	test("offers nothing in Junk when the Inbox target hasn't loaded", () => {
		assert.equal(
			resolveSpamAction({
				mailboxId: junkId,
				junkMailboxId: junkId,
				inboxMailboxId: undefined,
			}),
			null,
		);
	});

	test("offers nothing outside Junk when the Junk target hasn't loaded", () => {
		assert.equal(
			resolveSpamAction({
				mailboxId: inboxId,
				junkMailboxId: undefined,
				inboxMailboxId: inboxId,
			}),
			null,
		);
	});

	test("the two actions are mutually exclusive", () => {
		const inJunk = resolveSpamAction({
			mailboxId: junkId,
			junkMailboxId: junkId,
			inboxMailboxId: inboxId,
		});
		const elsewhere = resolveSpamAction({
			mailboxId: inboxId,
			junkMailboxId: junkId,
			inboxMailboxId: inboxId,
		});
		assert.notEqual(inJunk, elsewhere);
	});
});

describe("resolveSimilarState — fail-fast on similar-messages search", () => {
	test("a fatal 5xx does NOT show the grey label — it escalates instead (ready)", () => {
		assert.equal(
			resolveSimilarState({
				similarError: new Error("500"),
				similarErrorIsFatal: true,
				isSimilarLoading: false,
			}),
			"ready",
		);
	});

	test("a soft (non-fatal) error keeps the muted error state", () => {
		assert.equal(
			resolveSimilarState({
				similarError: new Error("404"),
				similarErrorIsFatal: false,
				isSimilarLoading: false,
			}),
			"error",
		);
	});

	test("an empty result (no error) is a soft ready state", () => {
		assert.equal(
			resolveSimilarState({
				similarError: null,
				similarErrorIsFatal: false,
				isSimilarLoading: false,
			}),
			"ready",
		);
	});

	test("loading wins when there is no error", () => {
		assert.equal(
			resolveSimilarState({
				similarError: null,
				similarErrorIsFatal: false,
				isSimilarLoading: true,
			}),
			"loading",
		);
	});
});
