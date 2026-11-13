import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { parseMessageBody } from "./body-parse.js";
import {
	classifyParsedMessage,
	extractPrimaryFromEmail,
} from "./classify-message.js";
import { openStore, type Store } from "./test-helpers/test-store.js";

const PLAIN_EML = Buffer.from(
	[
		"From: Alice <alice@example.com>",
		"To: me@example.com",
		"Subject: Hi",
		"Content-Type: text/plain",
		"",
		"hi",
	].join("\r\n"),
);

const LIST_EML = Buffer.from(
	[
		"From: Alice <alice@example.com>",
		"To: me@example.com",
		"Subject: Newsletter",
		"List-Id: <news.example.com>",
		"List-Unsubscribe: <https://example.com/unsub>",
		"Content-Type: text/plain",
		"",
		"this week in news",
	].join("\r\n"),
);

let store: Store;
before(async () => {
	store = await openStore();
});
after(() => store.close());

describe("classifyParsedMessage", () => {
	it("answers from the header rule table when the sender has no override", async () => {
		const parsed = await parseMessageBody(LIST_EML);

		const { fields: classification } = await classifyParsedMessage(
			store.address,
			"acc-1",
			parsed,
		);

		assert.equal(classification.category, "newsletter");
		assert.equal(classification.hasListUnsubscribe, true);
	});

	it("classifies mail with no From address by headers alone", async () => {
		const parsed = await parseMessageBody(
			Buffer.from(
				[
					"To: me@example.com",
					"Subject: Hi",
					"Content-Type: text/plain",
					"",
					"hi",
				].join("\r\n"),
			),
		);

		const { fields: classification } = await classifyParsedMessage(
			store.address,
			"acc-1",
			parsed,
		);

		assert.equal(classification.category, "uncategorized");
	});
});

describe("extractPrimaryFromEmail", () => {
	it("reads the first From address", async () => {
		const parsed = await parseMessageBody(PLAIN_EML);
		assert.equal(extractPrimaryFromEmail(parsed), "alice@example.com");
	});

	it("answers null when there is no From address to read", async () => {
		const parsed = await parseMessageBody(
			Buffer.from(["To: me@example.com", "", "hi"].join("\r\n")),
		);
		assert.equal(extractPrimaryFromEmail(parsed), null);
	});
});
