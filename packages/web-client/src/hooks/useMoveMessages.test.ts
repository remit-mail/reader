import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { removeMovedMessagesFromItems } from "./useMoveMessages.js";

const make = (
	overrides: Partial<RemitImapThreadMessageResponse> & {
		messageId: string;
		threadMessageId: string;
	},
): RemitImapThreadMessageResponse =>
	({
		threadId: "t1",
		mailboxId: "mb1",
		accountConfigId: "acc-1",
		subject: "s",
		fromName: "n",
		fromEmail: "e",
		sentDate: "2025-01-01T00:00:00Z",
		snippet: "",
		hasAttachment: false,
		hasStars: false,
		isRead: true,
		...overrides,
	}) as RemitImapThreadMessageResponse;

describe("removeMovedMessagesFromItems (#236)", () => {
	test("drops items whose messageId is in the set", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1" }),
			make({ messageId: "m2", threadMessageId: "tm2" }),
			make({ messageId: "m3", threadMessageId: "tm3" }),
		];
		const got = removeMovedMessagesFromItems(items, new Set(["m2"]));
		assert.deepStrictEqual(
			got.map((i) => i.messageId),
			["m1", "m3"],
		);
	});

	test("returns the input unchanged when nothing matches", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1" }),
			make({ messageId: "m2", threadMessageId: "tm2" }),
		];
		const got = removeMovedMessagesFromItems(items, new Set(["nope"]));
		assert.equal(got.length, 2);
	});

	test("returns an empty array when all items match", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1" }),
			make({ messageId: "m2", threadMessageId: "tm2" }),
		];
		const got = removeMovedMessagesFromItems(items, new Set(["m1", "m2"]));
		assert.deepStrictEqual(got, []);
	});

	test("returns an empty array for empty input", () => {
		const got = removeMovedMessagesFromItems([], new Set(["m1"]));
		assert.deepStrictEqual(got, []);
	});
});
