/**
 * Opening the filter-from-search editor: the seed count comes from the converted
 * literal predicate in one request, under the account the filter targets. No
 * capability probe — the deployment's semantic reach is read from the search's
 * own results on the surface, so a seed success is never blocked by a probe.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import type { OrganizeMatchPredicate } from "@/lib/organize/organize-model";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	httpError,
	mockFetch,
} from "../test-support/http";
import { useSearchFilterSeed } from "./useSearchFilterSeed";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const COUNTABLE: OrganizeMatchPredicate = {
	matchOperator: "And",
	literalClauses: [{ field: "From", value: "receipts@shop.example" }],
};

/**
 * A free-text search converts to a body-content clause, which the vector-free
 * matcher refuses. The seed must not ask.
 */
const UNCOUNTABLE: OrganizeMatchPredicate = {
	matchOperator: "And",
	literalClauses: [{ field: "HasWords", value: "receipts" }],
};

function probeFor(predicate: OrganizeMatchPredicate) {
	return function Probe() {
		const seed = useSearchFilterSeed("acc-1", predicate);
		return createElement(
			"div",
			null,
			JSON.stringify({
				seedCount: seed.seedCount ?? null,
				isPending: seed.isPending,
				isError: seed.isError,
				uncountable: seed.uncountable,
			}),
		);
	};
}

const mount = (
	responder: (call: HttpCall) => unknown,
	predicate: OrganizeMatchPredicate = COUNTABLE,
): DomHarness => {
	http = mockFetch(responder);
	harness = createDomHarness();
	harness.renderApp(createElement(probeFor(predicate)));
	return harness;
};

const state = (dom: DomHarness) => JSON.parse(dom.text());

describe("useSearchFilterSeed", () => {
	it("seeds the count from the literal predicate in a single preview", async () => {
		const dom = mount((call) =>
			call.path.endsWith("/organize/preview")
				? { matchedCount: 12, messageIds: [] }
				: {},
		);
		await dom.flush();
		await dom.flush();
		assert.equal(state(dom).seedCount, 12);
		// One preview, carrying the literal clauses and no anchor.
		const previews = http?.to("/organize/preview") ?? [];
		assert.equal(previews.length, 1);
		assert.equal(previews[0].body?.anchorMessageId, undefined);
		assert.deepEqual(previews[0].body?.literalClauses, [
			{ field: "From", value: "receipts@shop.example" },
		]);
	});

	it("surfaces the seed error so the caller can offer a retry", async () => {
		const dom = mount(() => httpError(500));
		await dom.flush();
		await dom.flush();
		assert.equal(state(dom).isError, true);
	});

	it("never asks for a count the matcher cannot produce", async () => {
		const dom = mount(
			(call) =>
				call.path.endsWith("/organize/preview")
					? { matchedCount: 12, messageIds: [] }
					: {},
			UNCOUNTABLE,
		);
		await dom.flush();
		await dom.flush();
		assert.equal(http?.to("/organize/preview").length, 0);
		// Not pending and not an error — the editor opens, it just has no number.
		assert.deepEqual(state(dom), {
			seedCount: null,
			isPending: false,
			isError: false,
			uncountable: true,
		});
	});
});
