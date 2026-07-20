import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildListThreadMessagesOptions,
	dedupeThreadMessages,
} from "./thread.js";

type Row = {
	threadMessageId: string;
	messageIdHeader?: string;
	createdAt: number;
};

const row = (
	threadMessageId: string,
	messageIdHeader: string | undefined,
	createdAt: number,
): Row => ({ threadMessageId, messageIdHeader, createdAt });

describe("buildListThreadMessagesOptions", () => {
	it("defaults to oldest-first and hides soft-deleted messages", () => {
		assert.deepEqual(buildListThreadMessagesOptions({}), {
			order: "asc",
			excludeDeleted: true,
		});
	});

	it("honours an explicit order", () => {
		assert.equal(
			buildListThreadMessagesOptions({ order: "desc" }).order,
			"desc",
		);
	});

	it("carries no mailbox filter, so sent messages stay in the conversation", () => {
		assert.ok(!("mailboxId" in buildListThreadMessagesOptions({})));
	});
});

describe("dedupeThreadMessages", () => {
	it("keeps a thread whose messages are all distinct", () => {
		const rows = [
			row("tm-1", "<a@example.test>", 10),
			row("tm-2", "<b@example.test>", 20),
		];
		assert.deepEqual(dedupeThreadMessages(rows), rows);
	});

	it("collapses a copied message to the original", () => {
		const original = row("tm-1", "<a@example.test>", 10);
		const copy = row("tm-2", "<a@example.test>", 50);
		assert.deepEqual(dedupeThreadMessages([original, copy]), [original]);
	});

	it("keeps the same row whichever order the rows arrive in", () => {
		const original = row("tm-1", "<a@example.test>", 10);
		const copy = row("tm-2", "<a@example.test>", 50);
		assert.deepEqual(dedupeThreadMessages([copy, original]), [original]);
	});

	it("breaks a createdAt tie on threadMessageId", () => {
		const first = row("tm-a", "<a@example.test>", 10);
		const second = row("tm-b", "<a@example.test>", 10);
		assert.deepEqual(dedupeThreadMessages([second, first]), [first]);
	});

	it("treats headers that differ only by surrounding space as one message", () => {
		const original = row("tm-1", "<a@example.test>", 10);
		const copy = row("tm-2", " <a@example.test> ", 50);
		assert.deepEqual(dedupeThreadMessages([original, copy]), [original]);
	});

	it("never merges rows without a usable header", () => {
		const rows = [
			row("tm-1", undefined, 10),
			row("tm-2", undefined, 20),
			row("tm-3", "<>", 30),
			row("tm-4", "", 40),
		];
		assert.deepEqual(dedupeThreadMessages(rows), rows);
	});

	it("leaves an empty thread empty", () => {
		assert.deepEqual(dedupeThreadMessages([]), []);
	});
});
