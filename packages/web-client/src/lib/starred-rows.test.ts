import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { dedupeByThread } from "./starred-rows.js";

// The starred listing returns one row per mailbox. The same mail filed in two
// folders is two rows sharing a threadId, both starred server-side, so a
// conversation would otherwise render twice.

const row = (
	threadId: string,
	messageId: string,
	mailboxId: string,
): RemitImapThreadMessageResponse =>
	({
		threadId,
		messageId,
		mailboxId,
	}) as unknown as RemitImapThreadMessageResponse;

describe("dedupeByThread", () => {
	test("collapses two copies of one conversation to a single row", () => {
		const result = dedupeByThread([
			row("t1", "m-inbox", "inbox"),
			row("t1", "m-archive", "archive"),
		]);

		assert.deepEqual(
			result.map((r) => r.messageId),
			["m-inbox"],
		);
	});

	test("keeps the first row, which is the newest under descending order", () => {
		const result = dedupeByThread([
			row("t1", "m-newest", "inbox"),
			row("t1", "m-older", "archive"),
		]);

		assert.equal(result[0]?.messageId, "m-newest");
	});

	test("leaves distinct conversations alone and preserves order", () => {
		const result = dedupeByThread([
			row("t1", "m1", "inbox"),
			row("t2", "m2", "inbox"),
			row("t3", "m3", "inbox"),
		]);

		assert.deepEqual(
			result.map((r) => r.threadId),
			["t1", "t2", "t3"],
		);
	});

	test("collapses copies that arrived on different pages", () => {
		const pageOne = [row("t1", "m1", "inbox"), row("t2", "m2", "inbox")];
		const pageTwo = [row("t2", "m2-copy", "archive"), row("t3", "m3", "inbox")];

		const result = dedupeByThread([...pageOne, ...pageTwo]);

		assert.deepEqual(
			result.map((r) => r.threadId),
			["t1", "t2", "t3"],
		);
	});

	test("an empty list stays empty", () => {
		assert.deepEqual(dedupeByThread([]), []);
	});
});
