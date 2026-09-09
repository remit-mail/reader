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
		);

		assert.equal(reads, 0);
		assert.equal(classification.category, "personal");
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
