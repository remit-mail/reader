/**
 * Removing a sender's category override (#615).
 *
 * A sender flag is removed by naming its key in `clearFlags`. `category` is the
 * flag that has no other way out: its value is a `MessageCategory` enum with no
 * false-equivalent member, so the `{ value: false }` form the boolean flags use
 * cannot express "no override", and the `null` form the schema documents is
 * rejected by the request validator. Before this the reclassify picker was
 * one-way — a reader could set an override and never take it back.
 *
 * Drives the real chain: the real `IntelligencePane`, the real
 * `useUpdateAddressFlags` mutation, and a fetch mock that answers the way the
 * server does. Both halves are asserted — the body that goes on the wire, and
 * that the override is gone from what the panel renders.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapAddressResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import {
	makeAccount,
	makeConfig,
	makeThreadMessage,
} from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { IntelligencePane } from "./IntelligencePane";

const thread = makeThreadMessage({ messageId: "msg-1", category: "personal" });

const addressWith = (
	flags: RemitImapAddressResponse["flags"],
): RemitImapAddressResponse => ({
	addressId: "addr-1",
	accountConfigId: "cfg-1",
	displayName: "Alice",
	localPart: "alice",
	domain: "example.com",
	normalizedEmail: "alice@example.com",
	flags,
	inboundCount: 6,
	outboundCount: 1,
	replyCount: 2,
	lastInboundAt: 1_000,
	lastReplyAt: 900,
	createdAt: 0,
	updatedAt: 0,
});

let harness: DomHarness | undefined;
let http: HttpMock;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("the reclassify picker on a sender that already carries an override", () => {
	it("removes the override with clearFlags, and the panel stops claiming one", async () => {
		let stored: RemitImapAddressResponse = addressWith({
			category: { value: "newsletter", setAt: 10 },
		});

		http = mockFetch((call) => {
			if (call.path.endsWith("/config")) {
				return makeConfig([makeAccount({ accountId: "acc-1" })], {
					semanticSearchEnabled: false,
				});
			}
			if (call.path.endsWith("/addresses/search")) {
				return { items: [stored] };
			}
			if (call.method === "PATCH" && call.path.endsWith("/addresses/addr-1")) {
				stored = addressWith({});
				return stored;
			}
			return { items: [] };
		});

		harness = createDomHarness();
		harness.renderApp(
			createElement(IntelligencePane, { thread, onClose: () => {} }),
		);

		await harness.waitFor(
			() => harness?.text().includes("your override") === true,
			"the panel never showed the sender's category override",
		);

		harness.click(harness.byText("button", "reclassify"));
		harness.click(
			harness.byText(
				"button",
				"Remove override — classify automatically again",
			),
		);

		await harness.waitFor(
			() => http.to("/addresses/addr-1").length === 1,
			"the remove control sent no request",
		);

		assert.deepEqual(http.to("/addresses/addr-1")[0].body, {
			clearFlags: ["category"],
		});

		await harness.waitFor(
			() => harness?.text().includes("your override") === false,
			"the override survived its own removal",
		);
	});

	it("offers no removal on a sender that carries no override", async () => {
		http = mockFetch((call) => {
			if (call.path.endsWith("/config")) {
				return makeConfig([makeAccount({ accountId: "acc-1" })], {
					semanticSearchEnabled: false,
				});
			}
			if (call.path.endsWith("/addresses/search")) {
				return { items: [addressWith({})] };
			}
			return { items: [] };
		});

		harness = createDomHarness();
		harness.renderApp(
			createElement(IntelligencePane, { thread, onClose: () => {} }),
		);

		await harness.waitFor(
			() => harness?.text().includes("reclassify") === true,
			"the panel never rendered the category section",
		);

		harness.click(harness.byText("button", "reclassify"));

		assert.equal(harness.text().includes("Remove override"), false);
	});
});
