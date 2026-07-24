/**
 * The widen step's two-phase preview. On a semantic-capable deployment it runs
 * the anchor preview once and stops. On a deployment that reports
 * `semanticUnavailable` (no vector pipeline — semantic-capability.ts) it
 * re-previews with sender-derived literal clauses — one `From` clause per
 * distinct sender, combined with `Or`, no anchor — and reports the literal match
 * count, so every commit scope acts on the sender-matched set.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement, useEffect } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { useOrganizeWiden } from "./useOrganizeWiden";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

type Widen = ReturnType<typeof useOrganizeWiden>;
type Responder = Parameters<typeof mockFetch>[0];

const PREVIEW_PATH = "/organize/preview";

const mount = (senders: string[], responder: Responder) => {
	http = mockFetch(responder);
	harness = createDomHarness();
	const holder: { current: Widen | undefined } = { current: undefined };
	function Probe() {
		const widen = useOrganizeWiden("acc-1", "msg-1", senders);
		holder.current = widen;
		const { preview } = widen;
		useEffect(() => {
			preview();
		}, [preview]);
		return null;
	}
	harness.renderApp(createElement(Probe));
	return holder;
};

async function settle(minCalls: number): Promise<void> {
	const dom = harness;
	const mock = http;
	if (!dom || !mock) throw new Error("not mounted");
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await dom.flush();
		if (mock.to(PREVIEW_PATH).length >= minCalls) {
			await dom.flush();
			await dom.wait(1);
			await dom.flush();
			return;
		}
		await dom.wait(1);
	}
}

describe("useOrganizeWiden — semantic-capable deployment", () => {
	it("previews the anchor once and reports the semantic match, no fallback", async () => {
		const holder = mount([], () => ({
			matchedCount: 42,
			messageIds: ["a", "b"],
			semanticUnavailable: false,
		}));
		await settle(1);

		assert.equal(http?.to(PREVIEW_PATH).length, 1);
		const [call] = http?.to(PREVIEW_PATH) ?? [];
		assert.equal(call.body?.anchorMessageId, "msg-1");
		assert.deepEqual(call.body?.literalClauses, []);

		const widen = holder.current;
		assert.equal(widen?.matchedCount, 42);
		assert.equal(widen?.semanticUnavailable, false);
		assert.equal(widen?.senderFallback, false);
		assert.deepEqual(widen?.matchPredicate, {
			anchorMessageId: "msg-1",
			matchOperator: "And",
			literalClauses: [],
		});
	});
});

describe("useOrganizeWiden — no vector pipeline, senders present", () => {
	it("re-previews with distinct sender From clauses combined with Or and no anchor", async () => {
		const holder = mount(
			["npm@github.com", "npm@github.com", "a@x.com"],
			(call) =>
				call.body?.anchorMessageId
					? { matchedCount: 0, messageIds: [], semanticUnavailable: true }
					: {
							matchedCount: 128,
							messageIds: ["m"],
							semanticUnavailable: false,
						},
		);
		await settle(2);

		const calls = http?.to(PREVIEW_PATH) ?? [];
		assert.equal(calls.length, 2);
		// The second preview is the literal fallback: no anchor, Or, distinct
		// sender From clauses.
		const second = calls[1];
		assert.equal(second.body?.anchorMessageId, undefined);
		assert.equal(second.body?.matchOperator, "Or");
		assert.deepEqual(second.body?.literalClauses, [
			{ field: "From", value: "npm@github.com" },
			{ field: "From", value: "a@x.com" },
		]);

		const widen = holder.current;
		assert.equal(widen?.matchedCount, 128);
		assert.equal(widen?.semanticUnavailable, true);
		assert.equal(widen?.senderFallback, true);
		assert.deepEqual(widen?.senders, ["npm@github.com", "a@x.com"]);
		assert.deepEqual(widen?.matchPredicate, {
			matchOperator: "Or",
			literalClauses: [
				{ field: "From", value: "npm@github.com" },
				{ field: "From", value: "a@x.com" },
			],
		});
	});
});

describe("useOrganizeWiden — no vector pipeline, no senders", () => {
	it("does not re-preview and stays capability-absent with the anchor predicate", async () => {
		const holder = mount([], () => ({
			matchedCount: 0,
			messageIds: [],
			semanticUnavailable: true,
		}));
		await settle(1);
		// Give any spurious second preview a chance to fire before asserting none did.
		await harness?.flush();

		assert.equal(http?.to(PREVIEW_PATH).length, 1);
		const widen = holder.current;
		assert.equal(widen?.semanticUnavailable, true);
		assert.equal(widen?.senderFallback, false);
		assert.deepEqual(widen?.senders, []);
		assert.equal(widen?.matchPredicate.anchorMessageId, "msg-1");
	});
});
