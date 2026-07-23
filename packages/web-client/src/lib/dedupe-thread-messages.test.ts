import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { dedupeThreadMessages } from "./dedupe-thread-messages.js";

function threadMessage(
	overrides: Partial<RemitImapThreadMessageResponse> = {},
): RemitImapThreadMessageResponse {
	return {
		threadId: "t1",
		threadMessageId: "tm1",
		messageId: "m1",
		accountConfigId: "cfg_1",
		mailboxId: "mb1",
		fromName: "Sender",
		fromEmail: "sender@example.com",
		subject: "Subject",
		snippet: "Snippet",
		sentDate: 1767225600,
		isRead: false,
		isDeleted: false,
		hasAttachment: false,
		hasStars: false,
		star: "none",
		senderTrust: "unknown",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

describe("dedupeThreadMessages (#166)", () => {
	test("collapses an overlapping page to one row per threadMessageId", () => {
		const pageOne = [
			threadMessage({ threadMessageId: "tm1", messageId: "m1" }),
			threadMessage({ threadMessageId: "tm2", messageId: "m2" }),
		];
		const pageTwo = [
			threadMessage({ threadMessageId: "tm2", messageId: "m2" }),
			threadMessage({ threadMessageId: "tm3", messageId: "m3" }),
		];

		const got = dedupeThreadMessages([...pageOne, ...pageTwo]);

		assert.deepStrictEqual(
			got.map((item) => item.threadMessageId),
			["tm1", "tm2", "tm3"],
		);
	});

	test("keeps the first occurrence's data when duplicates disagree", () => {
		const items = [
			threadMessage({ threadMessageId: "tm1", isRead: false }),
			threadMessage({ threadMessageId: "tm1", isRead: true }),
		];

		const got = dedupeThreadMessages(items);

		assert.equal(got.length, 1);
		assert.equal(got[0].isRead, false);
	});

	test("leaves non-overlapping pages unaffected", () => {
		const items = [
			threadMessage({ threadMessageId: "tm1", messageId: "m1" }),
			threadMessage({ threadMessageId: "tm2", messageId: "m2" }),
			threadMessage({ threadMessageId: "tm3", messageId: "m3" }),
		];

		const got = dedupeThreadMessages(items);

		assert.deepStrictEqual(got, items);
	});

	test("returns an empty array for empty input", () => {
		assert.deepStrictEqual(dedupeThreadMessages([]), []);
	});
});
