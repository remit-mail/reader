import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { selectMessagesToMarkRead } from "./useMarkAsRead.js";

const make = (
	overrides: Partial<RemitImapThreadMessageResponse> & {
		messageId: string;
		threadMessageId: string;
		isRead: boolean;
	},
): RemitImapThreadMessageResponse =>
	({
		threadId: "t1",
		mailboxId: "mb1",
		subject: "s",
		fromName: "n",
		fromEmail: "e",
		sentDate: "2025-01-01T00:00:00Z",
		snippet: "",
		hasAttachment: false,
		hasStars: false,
		...overrides,
	}) as RemitImapThreadMessageResponse;

describe("selectMessagesToMarkRead", () => {
	test("returns the unread expanded messages", () => {
		const messages = [
			make({ messageId: "m1", threadMessageId: "tm1", isRead: false }),
			make({ messageId: "m2", threadMessageId: "tm2", isRead: true }),
			make({ messageId: "m3", threadMessageId: "tm3", isRead: false }),
		];
		const expanded = new Set(["tm1", "tm3"]);
		const got = selectMessagesToMarkRead(
			messages,
			expanded,
			new Set(),
			new Set(),
		);
		assert.deepStrictEqual(got, ["m1", "m3"]);
	});

	test("skips already-read messages even when expanded", () => {
		const messages = [
			make({ messageId: "m1", threadMessageId: "tm1", isRead: true }),
		];
		const expanded = new Set(["tm1"]);
		const got = selectMessagesToMarkRead(
			messages,
			expanded,
			new Set(),
			new Set(),
		);
		assert.deepStrictEqual(got, []);
	});

	test("skips collapsed messages even when unread", () => {
		const messages = [
			make({ messageId: "m1", threadMessageId: "tm1", isRead: false }),
			make({ messageId: "m2", threadMessageId: "tm2", isRead: false }),
		];
		const expanded = new Set(["tm1"]);
		const got = selectMessagesToMarkRead(
			messages,
			expanded,
			new Set(),
			new Set(),
		);
		assert.deepStrictEqual(got, ["m1"]);
	});

	test("skips messages already marked in this session", () => {
		const messages = [
			make({ messageId: "m1", threadMessageId: "tm1", isRead: false }),
		];
		const expanded = new Set(["tm1"]);
		const got = selectMessagesToMarkRead(
			messages,
			expanded,
			new Set(["m1"]),
			new Set(),
		);
		assert.deepStrictEqual(got, []);
	});

	test("skips messages with an in-flight mutation", () => {
		const messages = [
			make({ messageId: "m1", threadMessageId: "tm1", isRead: false }),
		];
		const expanded = new Set(["tm1"]);
		const got = selectMessagesToMarkRead(
			messages,
			expanded,
			new Set(),
			new Set(["m1"]),
		);
		assert.deepStrictEqual(got, []);
	});

	test("returns empty list when nothing is expanded", () => {
		const messages = [
			make({ messageId: "m1", threadMessageId: "tm1", isRead: false }),
			make({ messageId: "m2", threadMessageId: "tm2", isRead: false }),
		];
		const got = selectMessagesToMarkRead(
			messages,
			new Set(),
			new Set(),
			new Set(),
		);
		assert.deepStrictEqual(got, []);
	});

	test("does not require all unread messages to be expanded", () => {
		// Regression: the previous policy gated firing on every unread
		// message being expanded, which meant most opens silently never
		// produced a mutation. The newest message being expanded must be
		// enough to mark it read.
		const messages = [
			make({ messageId: "m1", threadMessageId: "tm1", isRead: false }),
			make({ messageId: "m2", threadMessageId: "tm2", isRead: false }),
			make({ messageId: "m3", threadMessageId: "tm3", isRead: false }),
		];
		const expanded = new Set(["tm1"]);
		const got = selectMessagesToMarkRead(
			messages,
			expanded,
			new Set(),
			new Set(),
		);
		assert.deepStrictEqual(got, ["m1"]);
	});
});
