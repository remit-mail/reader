/**
 * Tests for `classifyParsedMessage` (issue #1197): the one classification
 * implementation shared by the body-store path and the classification
 * backfill, so the two can never classify the same bytes differently. Pins
 * the `Address.flags.category` override contract (issue #299, RFC 039
 * Decision 3) on its own, rather than only through body-sync's public
 * surface: the override wins outright, a genuinely-absent Address is "no
 * override", and any other read failure propagates rather than silently
 * classifying by headers when the user asked for something else.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressItem, IAddressRepository } from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";
import { DisplayNameCorrespondence } from "@remit/domain-enums";
import { parseMessageBody } from "./body-parse.js";
import {
	classifyParsedMessage,
	extractPrimaryFromEmail,
} from "./classify-message.js";

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

const addressService = (
	behavior: (accountConfigId: string, addressId: string) => unknown,
): Pick<IAddressRepository, "getAddress"> => ({
	getAddress: (async (accountConfigId: string, addressId: string) =>
		behavior(
			accountConfigId,
			addressId,
		)) as unknown as IAddressRepository["getAddress"],
});

const withFlags =
	(flags: AddressItem["flags"]): (() => AddressItem) =>
	() =>
		({ flags }) as AddressItem;

describe("classifyParsedMessage", () => {
	it("answers from the header rule table when the sender has no override", async () => {
		const parsed = await parseMessageBody(LIST_EML);

		const classification = await classifyParsedMessage(
			addressService(async () => {
				throw new NotFoundError("no Address row");
			}),
			"acc-1",
			parsed,
			"inbox",
		);

		assert.equal(classification.category, "newsletter");
		assert.equal(classification.hasListUnsubscribe, true);
	});

	it("substitutes the sender's flags.category override outright", async () => {
		const parsed = await parseMessageBody(PLAIN_EML);

		const classification = await classifyParsedMessage(
			addressService(withFlags({ category: { value: "marketing", setAt: 1 } })),
			"acc-1",
			parsed,
			"inbox",
		);

		// The header table alone would answer `personal`; the override wins
		// without blending (RFC 039 Decision 3).
		assert.equal(classification.category, "marketing");
	});

	it("propagates an Address read failure rather than classifying by headers", async () => {
		const parsed = await parseMessageBody(PLAIN_EML);

		await assert.rejects(
			classifyParsedMessage(
				addressService(async () => {
					throw new Error("throttled");
				}),
				"acc-1",
				parsed,
				"inbox",
			),
			/throttled/,
		);
	});

	it("reads no Address at all when the message has no From address", async () => {
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
		let reads = 0;

		const classification = await classifyParsedMessage(
			addressService(async () => {
				reads++;
				throw new NotFoundError("no Address row");
			}),
			"acc-1",
			parsed,
			"inbox",
		);

		assert.equal(reads, 0);
		assert.equal(classification.category, "personal");
	});
});

describe("classifyParsedMessage sender mismatch", () => {
	const noAddress = addressService(async () => {
		throw new NotFoundError("no Address row");
	});

	it("compares the sender of mail in Junk the provider rated clean", async () => {
		const parsed = await parseMessageBody(IMPERSONATION_EML);

		const classification = await classifyParsedMessage(
			noAddress,
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
			noAddress,
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
