import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildListThreadMessagesOptions } from "./thread.js";

describe("buildListThreadMessagesOptions", () => {
	it("defaults to newest-first and hides soft-deleted messages", () => {
		assert.deepEqual(buildListThreadMessagesOptions({}), {
			order: "desc",
			excludeDeleted: true,
		});
	});

	it("honours an explicit order", () => {
		assert.equal(buildListThreadMessagesOptions({ order: "asc" }).order, "asc");
	});

	it("carries no mailbox filter, so sent messages stay in the conversation", () => {
		assert.ok(!("mailboxId" in buildListThreadMessagesOptions({})));
	});
});
