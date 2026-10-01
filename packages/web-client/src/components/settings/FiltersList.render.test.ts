import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import type { LabelOption } from "@remit/ui";
import React, { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { FilterRunStatus } from "@/lib/organize/filter-run";
import { FiltersList } from "./FiltersList";

// The node test loader transpiles remit-ui's `.tsx` with the classic JSX
// runtime, which references a global `React`. Vite uses the automatic runtime,
// so this shim only exists for the SSR test harness.
(globalThis as { React?: typeof React }).React = React;

const NOW = Date.parse("2026-07-12T12:00:00Z");

const filter = (
	overrides: Partial<RemitImapFilterResponse>,
): RemitImapFilterResponse => ({
	filterId: "f-1",
	accountConfigId: "acc-1",
	name: "Travel",
	scope: "Standing",
	state: "Active",
	disabledReason: "None",
	hasAnchor: true,
	ruleChangedAt: 0,
	actionChangedAt: 0,
	matchOperator: "And",
	literalClauses: [],
	actionLabelId: "None",
	actionMailboxId: "mbx-travel",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

const render = (
	filters: RemitImapFilterResponse[],
	semanticUnavailable = false,
	labelById: Map<string, LabelOption> = new Map(),
	run: { runFilterId?: string; runStatus?: FilterRunStatus } = {},
) =>
	renderToString(
		createElement(FiltersList, {
			filters,
			mailboxName: (id: string) => (id === "mbx-travel" ? "Travel" : undefined),
			labelById,
			onEdit: () => undefined,
			onDelete: () => undefined,
			onToggle: () => undefined,
			onRunNow: () => undefined,
			...run,
			semanticUnavailable,
			now: NOW,
		}) as never,
	);

describe("FiltersList", () => {
	it("renders the empty state with a pointer to Organize", () => {
		const html = render([]);
		assert.match(html, /No filters yet/);
	});

	it("marks a standing filter Active and shows its move target", () => {
		const html = render([filter({})]);
		assert.match(html, /Active/);
		assert.match(html, /Moves matches to Travel/);
		assert.match(html, /always/);
	});

	it("opens the row's rule in the editor", () => {
		const html = render([filter({})]);
		assert.match(html, /Edit filter Travel/);
	});

	it("shows the widen chip for an anchored filter where the deployment can serve it", () => {
		const html = render([filter({ hasAnchor: true })]);
		assert.match(html, /and anything similar/i);
	});

	it("lists the widen chip inactive on a deployment that cannot evaluate it (D4)", () => {
		const html = render([filter({ hasAnchor: true })], true);
		assert.match(html, /not available here/i);
		assert.doesNotMatch(html, /and anything similar/i);
	});

	it("shows no widen chip for a purely literal filter", () => {
		const html = render([filter({ hasAnchor: false })]);
		assert.doesNotMatch(html, /similar/i);
	});

	it("shows the applied label's chip when the filter has a label action (issue #26)", () => {
		const labelById = new Map<string, LabelOption>([
			["lbl-1", { id: "lbl-1", name: "Receipts", color: "Blue" }],
		]);
		const html = render([filter({ actionLabelId: "lbl-1" })], false, labelById);
		assert.match(html, /Receipts/);
	});

	it("shows no label chip when the filter has no label action", () => {
		const html = render([filter({ actionLabelId: "None" })]);
		assert.doesNotMatch(html, /bg-blue-500|bg-red-500|bg-green-500/);
	});

	it("keeps an expired temporary filter visible and marks it Expired (RFC 034 Decision 1.2)", () => {
		const html = render([
			filter({
				filterId: "f-2",
				name: "Lisbon trip",
				scope: "Temporary",
				state: "Active",
				expiresAt: "2026-07-10T00:00:00Z",
			}),
		]);
		assert.match(html, /Lisbon trip/);
		assert.match(html, /Expired/);
		assert.match(html, /expired/);
	});

	it("offers to turn a running filter off", () => {
		const html = render([filter({})]);
		assert.match(html, /Turn off filter Travel/);
		assert.doesNotMatch(html, /Disabled/);
	});

	const reasons = [
		["UserDisabled", /Turned off\./],
		["AwaitingFolder", /Off until its folder exists on the mail server/],
		["FolderCreateFailed", /refused to create its folder/],
		["FolderMissing", /no longer exists/],
	] as const;

	it("drops the turns-on-by-itself copy once the user picked a folder", () => {
		const html = render([
			filter({
				state: "Disabled",
				disabledReason: "AwaitingFolder",
				actionMailboxId: "mbx-travel",
			}),
		]);
		assert.doesNotMatch(html, /turns on by itself/);
		assert.match(html, /Turned off\./);
	});

	for (const [reason, copy] of reasons) {
		it(`marks a filter disabled for ${reason} with its reason and a way back on (#1103)`, () => {
			const html = render([
				filter({
					state: "Disabled",
					disabledReason: reason,
					actionMailboxId: "None",
				}),
			]);
			assert.match(html, /Disabled/);
			assert.match(html, copy);
			assert.match(html, /Turn on filter Travel/);
		});
	}

	it("offers Run now on an active filter with an action (#1354)", () => {
		const html = render([filter({})]);
		assert.match(html, /Run now: filter Travel/);
		assert.match(html, />Run now</);
	});

	it("offers no Run now on a turned-off or expired filter", () => {
		const html = render([
			filter({ state: "Disabled", disabledReason: "UserDisabled" }),
			filter({
				filterId: "f-2",
				name: "Lisbon trip",
				scope: "Temporary",
				expiresAt: "2026-07-10T00:00:00Z",
			}),
		]);
		assert.doesNotMatch(html, /Run now/);
	});

	it("offers no Run now on a filter with nothing to do", () => {
		const html = render([
			filter({ actionMailboxId: "None", actionLabelId: "None" }),
		]);
		assert.doesNotMatch(html, /Run now/);
	});

	it("says the run is going on the filter that was run, and holds the button", () => {
		const html = render([filter({})], false, new Map(), {
			runFilterId: "f-1",
			runStatus: { kind: "running" },
		});
		assert.match(html, /role="status"/);
		assert.match(html, /Running over the inbox/);
		assert.match(html, /disabled=""/);
	});

	it("reports what the run filed once the job is done", () => {
		const html = render([filter({})], false, new Map(), {
			runFilterId: "f-1",
			runStatus: { kind: "done", matched: 3, applied: 2 },
		});
		assert.match(html, /Filed 2 of 3 matching messages in the inbox/);
	});

	it("says so when nothing in the inbox matched", () => {
		const html = render([filter({})], false, new Map(), {
			runFilterId: "f-1",
			runStatus: { kind: "done", matched: 0, applied: 0 },
		});
		assert.match(html, /Nothing in the inbox matched/);
	});

	it("puts no stale status on the row when the run failed", () => {
		const html = render([filter({})], false, new Map(), {
			runFilterId: "f-1",
			runStatus: { kind: "failed", error: new Error("turned off") },
		});
		assert.doesNotMatch(html, /role="status"/);
		assert.match(html, />Run now</);
	});
});
