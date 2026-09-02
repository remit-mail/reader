/**
 * The result count is one question asked of the server, not a walk of the
 * pages (#307).
 *
 * The header used to render `threads.length`, which understated every search
 * matching more than one page and climbed as the reader scrolled. These mount
 * the real hook against the real fetch seam and read what actually left: the
 * whole match set from one request, no second request when the list pages, and
 * nothing at all for a query still being typed.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { ResultCount } from "@remit/ui";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { type ThreadSearchCriteria, useResultCount } from "./useResultCount.js";

const INBOX = "mbx-inbox";
/** Far more than a page holds — the number the header must not derive itself. */
const TOTAL_MATCHES = 1284;

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

/** Count-only requests, in order — the ones that asked for a number. */
const countRequests = () =>
	(http?.to("/threads/search") ?? []).filter(
		(call) =>
			new URL(call.url, "http://localhost").searchParams.get("count") ===
			"true",
	);

const mount = async (
	criteria: ThreadSearchCriteria,
	enabled: boolean,
	answer: unknown = { items: [], count: TOTAL_MATCHES },
): Promise<{ count: () => ResultCount; rerender: () => Promise<void> }> => {
	http = mockFetch((call) =>
		call.path.endsWith("/threads/search") ? answer : { items: [] },
	);

	let value: ResultCount | undefined;
	const Probe = ({ search }: { search: ThreadSearchCriteria }) => {
		value = useResultCount({ mailboxId: INBOX, criteria: search, enabled });
		return null;
	};

	const mounted = createDomHarness();
	harness = mounted;
	const render = async () => {
		mounted.renderApp(createElement(Probe, { search: criteria }));
		await mounted.flush();
		await mounted.wait(20);
		await mounted.flush();
	};
	await render();
	return {
		count: () => {
			if (!value) throw new Error("hook did not render");
			return value;
		},
		rerender: render,
	};
};

describe("useResultCount (#307)", () => {
	it("answers with the whole match set the server counted", async () => {
		const probe = await mount({ query: "invoice" }, true);

		assert.deepEqual(probe.count(), { kind: "exact", value: TOTAL_MATCHES });
		assert.equal(countRequests().length, 1);
	});

	it("asks with no cursor, so paging the list never re-counts", async () => {
		const probe = await mount({ query: "invoice" }, true);
		await probe.rerender();
		await probe.rerender();

		assert.equal(
			countRequests().length,
			1,
			"the count was asked again for a predicate that did not change",
		);
		const asked = new URL(countRequests()[0]?.url ?? "", "http://localhost")
			.searchParams;
		assert.equal(asked.get("continuationToken"), null);
		assert.equal(asked.get("results"), "false");
	});

	it("issues no request at all while it is disabled", async () => {
		const probe = await mount({ query: "in" }, false);

		assert.equal(countRequests().length, 0);
		assert.deepEqual(
			probe.count(),
			{ kind: "unknown" },
			"an uncounted search reported a number",
		);
	});

	it("reports no number when the server withholds the count", async () => {
		const probe = await mount({ query: "invoice" }, true, { items: [] });

		assert.deepEqual(
			probe.count(),
			{ kind: "unknown" },
			"an absent count became a zero",
		);
	});
});
