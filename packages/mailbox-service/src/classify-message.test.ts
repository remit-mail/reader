import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DisplayNameCorrespondence } from "@remit/domain-enums";
import { parseMessageBody } from "./body-parse.js";
import {
	classifyParsedMessage,
	extractPrimaryFromEmail,
} from "./classify-message.js";
import { openStore, type Store } from "./test-helpers/store.js";

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

const IMPERSONATION_EML = Buffer.from(
	[
		"From: InfoMedics <billing@serviceupdatebank.atlassian.net>",
		"To: me@example.com",
		"Subject: Openstaande factuur",
		"DKIM-Signature: v=1; a=rsa-sha256; d=atlassian.net; s=sel; b=xxx",
		"Content-Type: text/html",
		"",
		'<a href="https://betaal-vordering.example.org/pay">Betaal uw factuur</a>',
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

		const classification = await classifyParsedMessage(
			store.address,
			"acc-1",
			parsed,
			"inbox",
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

		const classification = await classifyParsedMessage(
			store.address,
			"acc-1",
			parsed,
			"inbox",
		);

		assert.equal(classification.category, "personal");
	});
});

describe("classifyParsedMessage sender mismatch", () => {
	it("compares the sender of mail in Junk the provider rated clean", async () => {
		const parsed = await parseMessageBody(IMPERSONATION_EML);

		const classification = await classifyParsedMessage(
			store.address,
			"acc-1",
			parsed,
			"junk",
		);

		assert.equal(
			classification.authenticity?.displayNameCorrespondence,
			DisplayNameCorrespondence.Unrelated,
		);
		assert.deepEqual(classification.authenticity?.offDomainLinkDomains, [
			"example.org",
		]);
	});

	it("compares nothing for the same mail outside Junk without a provider verdict", async () => {
		const parsed = await parseMessageBody(IMPERSONATION_EML);

		const classification = await classifyParsedMessage(
			store.address,
			"acc-1",
			parsed,
			"inbox",
		);

		assert.equal(
			classification.authenticity?.displayNameCorrespondence,
			undefined,
		);
		assert.equal(classification.authenticity?.offDomainLinkDomains, undefined);
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
