import assert from "node:assert";
import { describe, test } from "node:test";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { threadToSearchResult } from "./search-result.js";

describe("threadToSearchResult", () => {
	test("carries thread and mailbox so a literal hit opens directly", () => {
		const result = threadToSearchResult({
			messageId: "m1",
			threadId: "t1",
			mailboxId: "mb1",
			subject: "Hi",
			isRead: true,
			sentDate: 1_700_000_000_000,
		} as RemitImapThreadMessageResponse);
		assert.strictEqual(result.id, "m1");
		assert.strictEqual(result.threadId, "t1");
		assert.strictEqual(result.mailboxId, "mb1");
	});
});
