import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { toggleStarsInItems } from "./useToggleStar.js";

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
