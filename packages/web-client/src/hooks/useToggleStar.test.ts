import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { patchThreadListCache } from "../lib/thread-cache.js";
import {
	resolveMailboxForMessage,
	toggleStarsInItems,
} from "./useToggleStar.js";

const make = (
	messageId: string,
	hasStars: boolean,
): RemitImapThreadMessageResponse => ({
	senderTrust: "unknown",
	threadId: "t1",
	threadMessageId: `tm-${messageId}`,
	messageId,
	accountConfigId: "cfg_1",
	mailboxId: "mb1",
	subject: "s",
	fromName: "n",
	fromEmail: "e",
	sentDate: 1767225600,
	snippet: "",
	isRead: false,
	isDeleted: false,
	hasAttachment: false,
	star: "none",
	hasStars,
	createdAt: 0,
	updatedAt: 0,
});

describe("toggleStarsInItems", () => {
	test("stars only the target message", () => {
		const items = [make("m1", false), make("m2", false)];
		const got = toggleStarsInItems(items, "m1", true);
		assert.deepStrictEqual(
			got.map((i) => [i.messageId, i.hasStars]),
			[
				["m1", true],
				["m2", false],
			],
		);
	});

	test("unstars the target message", () => {
		const items = [make("m1", true)];
		const got = toggleStarsInItems(items, "m1", false);
		assert.strictEqual(got[0]?.hasStars, false);
	});

	test("leaves the list untouched when the message is absent", () => {
		const items = [make("m1", false)];
		const got = toggleStarsInItems(items, "missing", true);
		assert.deepStrictEqual(
			got.map((i) => i.hasStars),
			[false],
		);
	});
});

describe("resolveMailboxForMessage", () => {
	const messages = [
		{ ...make("m-received", false), mailboxId: "mb-inbox" },
		{ ...make("m-sent", false), mailboxId: "mb-sent" },
	];

	test("starring a sent reply patches the sent mailbox, not the browsed one", () => {
		assert.strictEqual(
			resolveMailboxForMessage("m-sent", messages, "mb-inbox"),
			"mb-sent",
		);
	});

	test("starring a message in the browsed mailbox is unchanged", () => {
		assert.strictEqual(
			resolveMailboxForMessage("m-received", messages, "mb-inbox"),
			"mb-inbox",
		);
	});

	test("falls back to the browsed mailbox when the thread is unknown", () => {
		assert.strictEqual(
			resolveMailboxForMessage("m-sent", undefined, "mb-inbox"),
			"mb-inbox",
		);
	});

	test("falls back to the browsed mailbox for a message not in the thread", () => {
		assert.strictEqual(
			resolveMailboxForMessage("m-elsewhere", messages, "mb-inbox"),
			"mb-inbox",
		);
	});
});

describe("starring across the unified-threads cache shapes", () => {
	// The Flagged view runs an infinite query on `listAllThreads({ starred:
	// true })`, which shares its query-key prefix with the single-shot readers.
	// A `setQueriesData` on that prefix therefore sees both shapes, and the
	// optimistic patch has to survive whichever it is handed — patching the
	// infinite entry as a plain `{ items }` threw and failed the star before it
	// was sent.
	const patch = (old: unknown) =>
		patchThreadListCache(old, (items) => toggleStarsInItems(items, "m1", true));

	test("patches the single-shot readers", () => {
		const patched = patch({
			items: [make("m1", false), make("m2", false)],
		}) as {
			items: RemitImapThreadMessageResponse[];
		};
		assert.equal(patched.items[0].hasStars, true);
		assert.equal(patched.items[1].hasStars, false);
	});

	test("patches the Flagged view's infinite query instead of throwing", () => {
		const patched = patch({
			pages: [{ items: [make("m1", false)] }, { items: [make("m2", false)] }],
			pageParams: [undefined, "next"],
		}) as { pages: Array<{ items: RemitImapThreadMessageResponse[] }> };
		assert.equal(patched.pages[0].items[0].hasStars, true);
		assert.equal(patched.pages[1].items[0].hasStars, false);
	});
});
