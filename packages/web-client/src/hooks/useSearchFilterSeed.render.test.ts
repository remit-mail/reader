/**
 * Opening the filter-from-search editor: the seed count comes from the converted
 * literal predicate, and the deployment's semantic capability is read from the
 * existing Organize preview signal — an anchored probe on the search's top
 * result — never a new endpoint. The probe fires only when there is free text to
 * embed and a message to anchor on.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import type { OrganizeMatchPredicate } from "@/lib/organize/sender-fallback";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpCall, type HttpMock, mockFetch } from "../test-support/http";
import { useSearchFilterSeed } from "./useSearchFilterSeed";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const PREDICATE: OrganizeMatchPredicate = {
	matchOperator: "And",
	literalClauses: [{ field: "HasWords", value: "receipts" }],
};

function Probe({
	hasFreeText,
	probeMessageId,
}: {
	hasFreeText: boolean;
	probeMessageId?: string;
}) {
	const seed = useSearchFilterSeed(
		"acc-1",
		PREDICATE,
		hasFreeText,
		probeMessageId,
	);
	return createElement(
		"div",
		null,
		JSON.stringify({
			seedCount: seed.seedCount ?? null,
			semanticAvailable: seed.semanticAvailable,
			isPending: seed.isPending,
		}),
	);
}

const responder =
	(semanticUnavailable: boolean) =>
	(call: HttpCall): unknown => {
		if (!call.path.endsWith("/organize/preview")) return {};
		if (call.body?.anchorMessageId !== undefined) {
			return { matchedCount: 99, messageIds: [], semanticUnavailable };
		}
		return { matchedCount: 12, messageIds: [] };
	};

const mount = (
	props: { hasFreeText: boolean; probeMessageId?: string },
	semanticUnavailable = false,
): DomHarness => {
	http = mockFetch(responder(semanticUnavailable));
	harness = createDomHarness();
	harness.renderApp(createElement(Probe, props));
	return harness;
};

const state = (dom: DomHarness) => JSON.parse(dom.text());

describe("useSearchFilterSeed", () => {
	it("seeds the count from the literal predicate, not the anchored probe", async () => {
		const dom = mount({ hasFreeText: true, probeMessageId: "msg-1" });
		await dom.flush();
		await dom.flush();
		assert.equal(state(dom).seedCount, 12);
	});

	it("reads capability from the anchored probe's semanticUnavailable", async () => {
		const dom = mount({ hasFreeText: true, probeMessageId: "msg-1" }, true);
		await dom.flush();
		await dom.flush();
		assert.equal(state(dom).semanticAvailable, false);

		const anchored = (http?.to("/organize/preview") ?? []).filter(
			(call) => call.body?.anchorMessageId !== undefined,
		);
		assert.equal(anchored.length, 1);
		assert.equal(anchored[0].body?.anchorMessageId, "msg-1");
	});

	it("treats a capable deployment as semantic-available", async () => {
		const dom = mount({ hasFreeText: true, probeMessageId: "msg-1" }, false);
		await dom.flush();
		await dom.flush();
		assert.equal(state(dom).semanticAvailable, true);
	});

	it("skips the probe when there is no free text to embed", async () => {
		const dom = mount({ hasFreeText: false, probeMessageId: "msg-1" });
		await dom.flush();
		await dom.flush();
		assert.equal(state(dom).semanticAvailable, true);
		const anchored = (http?.to("/organize/preview") ?? []).filter(
			(call) => call.body?.anchorMessageId !== undefined,
		);
		assert.equal(anchored.length, 0);
	});

	it("skips the probe when the search has no result to anchor on", async () => {
		const dom = mount({ hasFreeText: true, probeMessageId: undefined });
		await dom.flush();
		await dom.flush();
		assert.equal(state(dom).semanticAvailable, true);
		assert.equal((http?.to("/organize/preview") ?? []).length, 1);
	});
});
