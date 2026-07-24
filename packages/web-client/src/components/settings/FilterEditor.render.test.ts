/**
 * Editing a standing filter in the shared chip editor (RFC 038 D6), driven
 * through the real component in a DOM over the live update / preview / apply
 * endpoints.
 *
 * The contract these tests pin: a predicate or action change patches the
 * predicate fields (so the server bumps `ruleChangedAt`) and offers a
 * re-back-apply carrying exactly the previewed predicate; a cosmetic rename
 * patches the name alone and offers nothing (RFC 034 Decision 3.2). A degraded
 * filter lists its widen inactive and lets the user take it off.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import {
	type HttpCall,
	type HttpMock,
	mockFetch,
} from "../../test-support/http";
import { FilterEditor } from "./FilterEditor";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const ACCOUNT_ID = "acc-1";

const FOLDERS = [
	{ id: "mbx-receipts", label: "Receipts" },
	{ id: "mbx-archive", label: "Archive" },
];

const filterFixture = (
	overrides: Partial<RemitImapFilterResponse> = {},
): RemitImapFilterResponse => ({
	filterId: "f-1",
	accountConfigId: ACCOUNT_ID,
	name: "Receipts",
	scope: "Standing",
	state: "Active",
	hasAnchor: false,
	ruleChangedAt: 100,
	matchOperator: "And",
	literalClauses: [{ field: "From", value: "receipts@stripe.com" }],
	actionLabelId: "None",
	actionMailboxId: "mbx-receipts",
	createdAt: 0,
	updatedAt: 0,
	...overrides,
});

type Responder = (call: HttpCall) => unknown;

const backend = (previewCount = 8): Responder => {
	return (call) => {
		if (call.path.endsWith("/organize/preview")) {
			return { matchedCount: previewCount, messageIds: [] };
		}
		if (call.path.endsWith("/filters/f-1") && call.method === "PATCH") {
			return { ...filterFixture(), ruleChangedAt: 200 };
		}
		if (call.path.endsWith("/organize") && call.method === "POST") {
			return { organizeJobId: "job-1", state: "Running" };
		}
		if (call.path.endsWith("/organize/job-1")) {
			return {
				organizeJobId: "job-1",
				state: "Complete",
				matchedCount: previewCount,
				appliedCount: previewCount,
				failedCount: 0,
			};
		}
		return {};
	};
};

const mount = (
	filter: RemitImapFilterResponse,
	responder: Responder = backend(),
	semanticUnavailable = false,
): DomHarness => {
	http = mockFetch(responder);
	harness = createDomHarness();
	harness.renderApp(
		createElement(FilterEditor, {
			accountId: ACCOUNT_ID,
			filter,
			folders: FOLDERS,
			semanticUnavailable,
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

const addClause = (dom: DomHarness, field: string, value: string): void => {
	dom.click(primaryButton(dom, "Add clause"));
	dom.select(dom.byLabel("Clause field"), field);
	dom.type(dom.byLabel("Clause value"), value);
	dom.click(primaryButton(dom, "Add"));
};

const patchCalls = (): HttpCall[] =>
	(http?.calls ?? []).filter(
		(call) => call.path.endsWith("/filters/f-1") && call.method === "PATCH",
	);

describe("FilterEditor — open, edit, save round trip", () => {
	it("loads the persisted rule into the editor", async () => {
		const dom = mount(filterFixture());
		await settlePreview(dom);
		assert.match(dom.text(), /receipts@stripe\.com/);
		assert.equal(
			(dom.byLabel("Rule name") as HTMLInputElement).value,
			"Receipts",
		);
		assert.match(dom.text(), /Save rule/);
	});

	it("patches only the predicate on a clause change, leaving the name untouched", async () => {
		const dom = mount(filterFixture());
		await settlePreview(dom);

		addClause(dom, "Subject", "invoice");
		await settlePreview(dom);

		dom.click(primaryButton(dom, "Save rule"));
		await dom.flush();

		const patch = patchCalls();
		assert.equal(patch.length, 1);
		assert.equal(patch[0].body?.matchOperator, "And");
		assert.equal(patch[0].body?.actionMailboxId, "mbx-receipts");
		assert.deepEqual(patch[0].body?.literalClauses, [
			{ field: "From", value: "receipts@stripe.com" },
			{ field: "Subject", value: "invoice" },
		]);
		// The name is untouched, so it never travels — the partial patch preserves it.
		assert.equal("name" in (patch[0].body ?? {}), false);
	});
});

describe("FilterEditor — cosmetic rename (RFC 034 Decision 3.2)", () => {
	it("patches the name alone and offers no re-apply", async () => {
		const dom = mount(filterFixture());
		await settlePreview(dom);

		dom.type(dom.byLabel("Rule name"), "Invoices");
		dom.click(primaryButton(dom, "Save rule"));
		await dom.flush();

		const patch = patchCalls();
		assert.equal(patch.length, 1);
		assert.deepEqual(patch[0].body, { name: "Invoices" });

		// No predicate field, so the server leaves ruleChangedAt alone — and the
		// editor never offers to move existing mail.
		assert.match(dom.text(), /Filter updated/);
		assert.doesNotMatch(dom.text(), /Move existing mail/);
	});
});

describe("FilterEditor — rule change offers the re-back-apply", () => {
	it("offers a re-apply that carries exactly the previewed predicate", async () => {
		const dom = mount(filterFixture());
		await settlePreview(dom);

		addClause(dom, "Subject", "invoice");
		await settlePreview(dom);

		dom.click(primaryButton(dom, "Save rule"));
		await dom.flush();

		// The rule changed, so the editor offers to move the mail already filed.
		assert.match(dom.text(), /Move existing mail/);

		dom.click(primaryButton(dom, "Move existing mail"));
		await dom.flush();

		const previews = http?.to("/organize/preview") ?? [];
		const lastPreview = previews[previews.length - 1];
		const applied = (http?.calls ?? []).filter(
			(call) => call.path.endsWith("/organize") && call.method === "POST",
		);
		assert.equal(applied.length, 1);
		// Apply carries exactly the predicate the settled preview counted.
		assert.equal(applied[0].body?.matchOperator, "And");
		assert.deepEqual(
			applied[0].body?.literalClauses,
			lastPreview.body?.literalClauses,
		);
		assert.deepEqual(applied[0].body?.literalClauses, [
			{ field: "From", value: "receipts@stripe.com" },
			{ field: "Subject", value: "invoice" },
		]);
	});
});

describe("FilterEditor — degraded semantic filter (RFC 038 D4)", () => {
	it("lists the widen inactive and lets the user remove it as a rule change", async () => {
		const dom = mount(filterFixture({ hasAnchor: true }), backend(), true);
		await settlePreview(dom);

		// The anchor this deployment cannot evaluate lists inactive.
		assert.match(dom.text(), /not available here/i);

		dom.click(dom.byLabel("Remove the similar-mail widen"));
		await settlePreview(dom);

		dom.click(primaryButton(dom, "Save rule"));
		await dom.flush();

		// Taking the dead anchor off is a rule change: the patch reasserts the
		// predicate and the editor offers the re-apply.
		const patch = patchCalls();
		assert.equal(patch.length, 1);
		assert.equal(patch[0].body?.matchOperator, "And");
		assert.match(dom.text(), /Move existing mail/);
	});
});
