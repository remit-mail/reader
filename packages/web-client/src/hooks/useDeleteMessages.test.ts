import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	dropDeletedThreads,
	removeMessagesFromItems,
} from "./useDeleteMessages.js";

const make = (
	overrides: Partial<RemitImapThreadMessageResponse> & {
		messageId: string;
		threadMessageId: string;
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
		isRead: true,
		...overrides,
	}) as RemitImapThreadMessageResponse;

describe("removeMessagesFromItems", () => {
	test("drops items whose messageId is in the set", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1" }),
			make({ messageId: "m2", threadMessageId: "tm2" }),
			make({ messageId: "m3", threadMessageId: "tm3" }),
		];
		const got = removeMessagesFromItems(items, new Set(["m2"]));
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
		const got = removeMessagesFromItems(items, new Set(["does-not-exist"]));
		assert.equal(got.length, 2);
	});

	test("returns an empty array when all items match", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1" }),
			make({ messageId: "m2", threadMessageId: "tm2" }),
		];
		const got = removeMessagesFromItems(items, new Set(["m1", "m2"]));
		assert.deepStrictEqual(got, []);
	});

	test("returns an empty array for empty input", () => {
		const got = removeMessagesFromItems([], new Set(["m1"]));
		assert.deepStrictEqual(got, []);
	});
});

describe("dropDeletedThreads (#212)", () => {
	// Belt-and-braces UI filter for issue #212. If the backend regresses and
	// returns a soft-deleted row, the inbox list must still hide it. The
	// dedicated helper makes the regression cheap to test without rendering
	// React.

	test("drops items with isDeleted=true and keeps the rest", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1", isDeleted: false }),
			make({ messageId: "m2", threadMessageId: "tm2", isDeleted: true }),
			make({ messageId: "m3", threadMessageId: "tm3" }),
		];
		const got = dropDeletedThreads(items);
		assert.deepStrictEqual(
			got.map((i) => i.messageId),
			["m1", "m3"],
		);
	});

	test("returns the input unchanged when nothing is deleted", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1" }),
			make({ messageId: "m2", threadMessageId: "tm2", isDeleted: false }),
		];
		const got = dropDeletedThreads(items);
		assert.equal(got.length, 2);
	});

	test("returns an empty array when every row is deleted", () => {
		const items = [
			make({ messageId: "m1", threadMessageId: "tm1", isDeleted: true }),
			make({ messageId: "m2", threadMessageId: "tm2", isDeleted: true }),
		];
		const got = dropDeletedThreads(items);
		assert.deepStrictEqual(got, []);
	});
});
