import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	resolveMailboxesForMessages,
	selectMessagesToMarkRead,
} from "./useMarkAsRead.js";

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

	test("marks an older selected message when newest is already read (#683)", () => {
		// Regression: ConversationView opens with order:"desc" so messages[0] is
		// the newest. When the user clicks a thread row whose representative
		// message is an older unread message (not the newest), only that older
		// message must be marked. The newest is already read and must be skipped.
		const messages = [
			// Newest — already read (messages[0] in desc order)
			make({
				messageId: "m-newest",
				threadMessageId: "tm-newest",
				isRead: true,
			}),
			// Older — unread, the one the user clicked in the thread list
			make({
				messageId: "m-older",
				threadMessageId: "tm-older",
				isRead: false,
			}),
		];
		// ConversationView now expands both messages[0] AND the selected message.
		// Here the selected message is the older one, so both are expanded.
		const expanded = new Set(["tm-newest", "tm-older"]);
		const got = selectMessagesToMarkRead(
			messages,
			expanded,
			new Set(),
			new Set(),
		);
		// Only the unread older message should be marked — the newest is already read.
		assert.deepStrictEqual(got, ["m-older"]);
	});
});

describe("resolveMailboxesForMessages", () => {
	const messages = [
		make({
			messageId: "m-received",
			threadMessageId: "tm1",
			isRead: false,
			mailboxId: "mb-inbox",
		}),
		make({
			messageId: "m-sent",
			threadMessageId: "tm2",
			isRead: false,
			mailboxId: "mb-sent",
		}),
	];

	test("names every mailbox the batch touches, not the browsed one", () => {
		const got = resolveMailboxesForMessages(
			["m-received", "m-sent"],
			messages,
			"mb-inbox",
		);
		assert.deepStrictEqual([...got].sort(), ["mb-inbox", "mb-sent"]);
	});

	test("marking only the sent reply leaves the browsed mailbox alone", () => {
		const got = resolveMailboxesForMessages(["m-sent"], messages, "mb-inbox");
		assert.deepStrictEqual(got, ["mb-sent"]);
	});

	test("names each mailbox once however many messages it holds", () => {
		const got = resolveMailboxesForMessages(
			["m-received", "m-received"],
			messages,
			"mb-inbox",
		);
		assert.deepStrictEqual(got, ["mb-inbox"]);
	});

	test("falls back to the browsed mailbox for an unknown message", () => {
		const got = resolveMailboxesForMessages(
			["m-elsewhere"],
			messages,
			"mb-inbox",
		);
		assert.deepStrictEqual(got, ["mb-inbox"]);
	});
});
