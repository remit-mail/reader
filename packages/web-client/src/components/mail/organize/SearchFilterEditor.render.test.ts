/**
 * The filter-from-search chip editor (RFC 038 D5) over the live preview/apply
 * endpoints. The contract these tests pin: the converted clauses open pre-filled,
 * the conversion states honestly what the search carried that the filter cannot,
 * and the count on screen is the literal set a commit acts on — the commit is
 * blocked until the count settles and carries exactly the previewed predicate.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement } from "react";
import { convertSearchToRule } from "@/lib/organize/search-to-rule";
import {
	parseSearchTokens,
	type SearchTokenContext,
} from "@/lib/search-tokens";
import { createDomHarness, type DomHarness } from "../../../test-support/dom";
import { makeMailbox } from "../../../test-support/fixtures";
import {
	type HttpCall,
	type HttpMock,
	mockFetch,
} from "../../../test-support/http";
import { SearchFilterEditor } from "./SearchFilterEditor";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const ACCOUNT_ID = "acc-1";

const MAILBOXES = [
	makeMailbox({ mailboxId: "mbx-inbox", fullPath: "INBOX" }),
	makeMailbox({ mailboxId: "mbx-archive", fullPath: "Archive" }),
];

const CONTEXT: SearchTokenContext = {
	mailboxesByName: new Map([["archive", "mbx-archive"]]),
	accountsByName: new Map(),
};

const conversion = (query: string, searchHadSemanticReach = false) =>
	convertSearchToRule(parseSearchTokens(query, CONTEXT), {
		searchHadSemanticReach,
	});

type Responder = (call: HttpCall) => unknown;

const previewCounts = (counts: number[]): Responder => {
	let index = 0;
	return (call) => {
		if (call.path.endsWith("/organize/preview")) {
			const count = counts[Math.min(index, counts.length - 1)];
			index += 1;
			return { matchedCount: count, messageIds: [] };
		}
		if (call.path.endsWith("/filters")) {
			return { filterId: "filter-1", name: "R", scope: "Standing" };
		}
		if (call.path.endsWith("/organize") && call.method === "POST") {
			return { organizeJobId: "job-1", state: "Running" };
		}
		if (call.path.endsWith("/organize/job-1")) {
			return {
				organizeJobId: "job-1",
				state: "Complete",
				matchedCount: 3,
				appliedCount: 3,
				failedCount: 0,
			};
		}
		return {};
	};
};

const mount = (
	query: string,
	responder: Responder = previewCounts([12]),
	searchHadSemanticReach = false,
): DomHarness => {
	http = mockFetch(responder);
	harness = createDomHarness();
	harness.queryClient.setQueryData(
		mailboxOperationsListMailboxesQueryKey({ path: { accountId: ACCOUNT_ID } }),
		{ items: MAILBOXES },
	);
	harness.renderApp(
		createElement(SearchFilterEditor, {
			accountId: ACCOUNT_ID,
			conversion: conversion(query, searchHadSemanticReach),
			seedCount: 12,
			onClose: () => undefined,
		}),
	);
	return harness;
};

async function settlePreview(dom: DomHarness): Promise<void> {
	await dom.flush();
	await dom.wait(400);
	await dom.flush();
	await dom.flush();
}

const primaryButton = (dom: DomHarness, label: string): HTMLButtonElement =>
	dom.byText("button", label) as HTMLButtonElement;

describe("SearchFilterEditor — pre-filled conversion", () => {
	it("opens on the converted clauses", () => {
		const dom = mount("from:alerts@github.com pull request");
		assert.match(dom.text(), /alerts@github\.com/);
		assert.match(dom.text(), /pull request/);
	});

	it("seeds the live count from the converted predicate", () => {
		const dom = mount("receipts");
		assert.match(dom.text(), /12 messages match/);
	});

	it("does not offer the semantic widen on a search-derived rule", () => {
		const dom = mount("receipts");
		assert.doesNotMatch(dom.text(), /and similar/i);
	});
});

describe("SearchFilterEditor — conversion honesty (RFC 038 D5)", () => {
	it("states a folder-scoped search is kept out of the filter", () => {
		const dom = mount("in:archive receipts");
		assert.match(dom.text(), /limited to archive/i);
		assert.match(dom.text(), /any folder/i);
	});

	it("names the dropped attribute facets", () => {
		const dom = mount("invoice has:attachment is:unread");
		assert.match(dom.text(), /Has attachment/);
		assert.match(dom.text(), /Unread/);
		assert.match(dom.text(), /left out/);
	});

	it("states the dropped semantic reach when the search surfaced similar mail", () => {
		const dom = mount("things like this", previewCounts([12]), true);
		assert.match(dom.text(), /matches these words literally/i);
		assert.match(dom.text(), /similar mail/i);
		// The widen chip is never offered on a search-derived rule.
		assert.doesNotMatch(dom.text(), /and anything similar/i);
	});

	it("says nothing about semantics when the search had no similar mail", () => {
		const dom = mount("things like this", previewCounts([12]), false);
		assert.doesNotMatch(dom.text(), /similar mail/i);
	});
});

describe("SearchFilterEditor — commit gate", () => {
	it("blocks the save until a folder and name are set, then commits the previewed predicate", async () => {
		const dom = mount("from:alerts@github.com receipts");

		// Standing is the default scope: it needs a folder and a name.
		assert.equal(primaryButton(dom, "Save rule").disabled, true);
		dom.select(dom.byLabel("Destination folder"), "mbx-archive");
		await dom.flush();
		dom.type(dom.byLabel("Rule name"), "GitHub receipts");
		await dom.flush();
		assert.equal(primaryButton(dom, "Save rule").disabled, false);

		dom.click(primaryButton(dom, "Save rule"));
		await dom.flush();

		const filters = http?.to("/filters") ?? [];
		assert.equal(filters.length, 1);
		assert.equal(filters[0].body?.scope, "Standing");
		assert.deepEqual(filters[0].body?.literalClauses, [
			{ field: "From", value: "alerts@github.com" },
			{ field: "HasWords", value: "receipts" },
		]);
		assert.match(dom.text(), /Filter saved/);
	});

	it("stales the count on an edit and holds the save until it settles", async () => {
		// The seed count (12) is passed directly; the first network preview is the
		// re-count after the edit, so it returns 40.
		const dom = mount("receipts", previewCounts([40]));
		dom.select(dom.byLabel("Destination folder"), "mbx-archive");
		await dom.flush();
		dom.type(dom.byLabel("Rule name"), "Receipts");
		await dom.flush();

		dom.click(primaryButton(dom, "Add clause"));
		dom.select(dom.byLabel("Clause field"), "Subject");
		dom.type(dom.byLabel("Clause value"), "paid");
		dom.click(primaryButton(dom, "Add"));
		await dom.flush();

		// The count is stale and the save is blocked until the re-preview lands.
		assert.match(dom.text(), /recounting/i);
		assert.equal(primaryButton(dom, "Save rule").disabled, true);

		await settlePreview(dom);
		assert.match(dom.text(), /40 messages match/);
		assert.equal(primaryButton(dom, "Save rule").disabled, false);
	});

	it("runs a one-time apply as a back-apply job when the scope is 'just once'", async () => {
		const dom = mount("receipts");
		dom.select(dom.byLabel("Destination folder"), "mbx-archive");
		await dom.flush();
		const radio = dom.query('input[name="rule-scope"][value="once"]');
		if (!radio) throw new Error("no once scope option");
		dom.click(radio);
		await dom.flush();

		dom.click(primaryButton(dom, "Apply now"));
		await dom.flush();
		const jobs = (http?.to("/organize") ?? []).filter(
			(call) => call.method === "POST",
		);
		assert.equal(jobs.length, 1);
	});
});
