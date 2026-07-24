/**
 * The Organize chip editor (RFC 038 D1) over the live preview/apply endpoints.
 *
 * The contract these tests pin: the count on screen is the count that will be
 * applied. A clause change stales the count and blocks the commit until the
 * debounced re-preview settles; the commit then carries exactly the predicate
 * that was previewed. Capability gating (widen chip, clause vocabulary) and the
 * sender-fallback chips (#251) are covered here too, driven through the real
 * component in a DOM so nothing is asserted against a copy.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../../test-support/dom";
import { makeMailbox } from "../../../test-support/fixtures";
import {
	type HttpCall,
	type HttpMock,
	mockFetch,
} from "../../../test-support/http";
import { OrganizeRuleEditor } from "./OrganizeRuleEditor";

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

type Props = Parameters<typeof OrganizeRuleEditor>[0];
type Responder = (call: HttpCall) => unknown;

const previewCounts = (counts: number[]): Responder => {
	let index = 0;
	return (call) => {
		if (call.path.endsWith("/organize/preview")) {
			const count = counts[Math.min(index, counts.length - 1)];
			index += 1;
			return { matchedCount: count, messageIds: [] };
		}
		if (call.path.endsWith("/organize") && call.method === "POST") {
			return { organizeJobId: "job-1", state: "Running" };
		}
		if (call.path.endsWith("/organize/job-1")) {
			return {
				organizeJobId: "job-1",
				state: "Complete",
				matchedCount: 2,
				appliedCount: 2,
				failedCount: 0,
			};
		}
		if (call.path.endsWith("/filters")) {
			return { filterId: "filter-1", name: "R", scope: "Standing" };
		}
		return {};
	};
};

/**
 * A back-apply job that stays in flight, so the in-progress copy is observable
 * before the poll ever reaches a terminal state.
 */
const runningJob: Responder = (call) => {
	if (call.path.endsWith("/organize/preview")) {
		return { matchedCount: 2, messageIds: [] };
	}
	if (call.path.endsWith("/organize") && call.method === "POST") {
		return { organizeJobId: "job-1", state: "Running" };
	}
	if (call.path.endsWith("/organize/job-1")) {
		return {
			organizeJobId: "job-1",
			state: "Processing",
			matchedCount: 2,
			appliedCount: 0,
			failedCount: 0,
		};
	}
	return {};
};

const mount = (
	props: Partial<Props>,
	responder: Responder = previewCounts([0]),
): DomHarness => {
	http = mockFetch(responder);
	harness = createDomHarness();
	harness.queryClient.setQueryData(
		mailboxOperationsListMailboxesQueryKey({ path: { accountId: ACCOUNT_ID } }),
		{ items: MAILBOXES },
	);
	harness.renderApp(
		createElement(OrganizeRuleEditor, {
			accountId: ACCOUNT_ID,
			selectedMessageIds: ["msg-1", "msg-2"],
			seedCount: 47,
			onClose: () => undefined,
			...props,
		}),
	);
	return harness;
};

/** Let the debounced preview timer fire and its response settle. */
async function settlePreview(dom: DomHarness): Promise<void> {
	await dom.flush();
	await dom.wait(400);
	await dom.flush();
	await dom.flush();
}

const primaryButton = (dom: DomHarness, label: string): HTMLButtonElement =>
	dom.byText("button", label) as HTMLButtonElement;

/** Pick a segmented-control option (scope / operator) by its radio value. */
const pickSegment = (dom: DomHarness, name: string, value: string): void => {
	const radio = dom.query(`input[name="${name}"][value="${value}"]`);
	if (!radio) throw new Error(`no ${name} option "${value}"`);
	dom.click(radio);
};

describe("OrganizeRuleEditor — capability gating", () => {
	it("renders the semantic widen chip on a deployment that can serve it", () => {
		const dom = mount({});
		assert.match(dom.text(), /and anything similar/i);
		assert.match(dom.text(), /Similar to these 2/);
	});

	it("does not offer the widen when the deployment cannot serve it (D3/D4)", () => {
		const dom = mount({ semanticUnavailable: true, senders: [] });
		assert.doesNotMatch(dom.text(), /similar/i);
	});

	it("offers only the fields the backend can match — never ListId or FromDomain", () => {
		const dom = mount({});
		dom.click(primaryButton(dom, "Add clause"));
		const options = [...dom.byLabel("Clause field").querySelectorAll("option")];
		const labels = options.map((option) => option.textContent);
		assert.deepEqual(labels, ["From", "Subject", "Has the words"]);
	});
});

describe("OrganizeRuleEditor — sender fallback (#251)", () => {
	it("renders the derived sender addresses as visible, editable From chips", () => {
		const dom = mount({
			semanticUnavailable: true,
			senders: ["npm@github.com", "notifications@github.com"],
		});
		assert.match(dom.text(), /npm@github\.com/);
		assert.match(dom.text(), /notifications@github\.com/);
		assert.match(dom.text(), /from sender/i);
	});
});

describe("OrganizeRuleEditor — the previewed set equals the applied set", () => {
	it("blocks the commit while the count is stale, then applies exactly the previewed predicate", async () => {
		const dom = mount({}, previewCounts([12]));

		dom.select(dom.byLabel("Destination folder"), "mbx-archive");
		await dom.flush();

		// Seeded count, no clause yet: the commit is actionable.
		assert.equal(primaryButton(dom, "Apply now").disabled, false);

		// Add a Subject clause — the predicate changes, so the count is stale and
		// the commit must wait for the recount.
		dom.click(primaryButton(dom, "Add clause"));
		dom.select(dom.byLabel("Clause field"), "Subject");
		dom.type(dom.byLabel("Clause value"), "receipt");
		dom.click(primaryButton(dom, "Add"));
		await dom.flush();

		assert.match(dom.text(), /recounting/i);
		assert.equal(primaryButton(dom, "Apply now").disabled, true);

		await settlePreview(dom);

		// The recount landed for the new predicate: the commit unblocks.
		assert.equal(primaryButton(dom, "Apply now").disabled, false);

		// The debounced preview carried the new predicate.
		const preview = http?.to("/organize/preview") ?? [];
		assert.equal(preview.length, 1);
		assert.equal(preview[0].body?.anchorMessageId, "msg-1");
		assert.deepEqual(preview[0].body?.literalClauses, [
			{ field: "Subject", value: "receipt" },
		]);

		dom.click(primaryButton(dom, "Apply now"));
		await dom.flush();

		// Apply carries exactly what was previewed — anchor + the same clause.
		const applied = (http?.calls ?? []).filter(
			(call) => call.path.endsWith("/organize") && call.method === "POST",
		);
		assert.equal(applied.length, 1);
		assert.equal(applied[0].body?.anchorMessageId, "msg-1");
		assert.equal(applied[0].body?.matchOperator, "And");
		assert.deepEqual(applied[0].body?.literalClauses, [
			{ field: "Subject", value: "receipt" },
		]);
	});
});

describe("OrganizeRuleEditor — scope mapping", () => {
	it("saves a standing filter carrying the sender fallback clauses", async () => {
		const dom = mount({
			semanticUnavailable: true,
			senders: ["npm@github.com"],
			seedScope: "standing",
			seedMailboxId: "mbx-archive",
			seedCount: 128,
		});
		await dom.flush();

		dom.type(dom.byLabel("Rule name"), "GitHub");
		dom.click(primaryButton(dom, "Save rule"));
		await dom.flush();

		const created = (http?.calls ?? []).filter((call) =>
			call.path.endsWith("/filters"),
		);
		assert.equal(created.length, 1);
		assert.equal(created[0].body?.scope, "Standing");
		assert.equal(created[0].body?.name, "GitHub");
		assert.equal(created[0].body?.matchOperator, "Or");
		assert.deepEqual(created[0].body?.literalClauses, [
			{ field: "From", value: "npm@github.com" },
		]);
		assert.match(dom.text(), /Filter saved/);
	});

	it("saves an until-a-date filter with the derived expiry", async () => {
		const dom = mount({ seedMailboxId: "mbx-archive" });
		await dom.flush();

		pickSegment(dom, "rule-scope", "until");
		await dom.flush();
		dom.type(dom.byLabel("Rule name"), "Sale");
		dom.type(dom.byLabel("Expiry date"), "2999-01-02");
		dom.click(primaryButton(dom, "Save until then"));
		await dom.flush();

		const created = (http?.calls ?? []).filter((call) =>
			call.path.endsWith("/filters"),
		);
		assert.equal(created.length, 1);
		assert.equal(created[0].body?.scope, "Temporary");
		assert.ok(String(created[0].body?.expiresAt).startsWith("2999-01-02"));
	});
});

describe("OrganizeRuleEditor — back-apply progress copy (#250 honesty)", () => {
	async function startJob(dom: DomHarness): Promise<void> {
		dom.select(dom.byLabel("Destination folder"), "mbx-archive");
		await dom.flush();
		dom.click(primaryButton(dom, "Apply now"));
		for (let attempt = 0; attempt < 20; attempt += 1) {
			await dom.flush();
			if (/Organizing/.test(dom.text())) return;
			await dom.wait(1);
		}
	}

	it("keeps the similar-mail wording on the semantic path", async () => {
		const dom = mount({}, runningJob);
		await startJob(dom);
		assert.match(dom.text(), /Organizing similar mail/);
		assert.doesNotMatch(dom.text(), /from these senders/);
	});

	it("states the sender semantics in the sender fallback", async () => {
		const dom = mount(
			{
				semanticUnavailable: true,
				senders: ["npm@github.com"],
				seedCount: 128,
			},
			runningJob,
		);
		await startJob(dom);
		assert.match(dom.text(), /Organizing mail from these senders/);
		assert.doesNotMatch(dom.text(), /Organizing similar mail/);
	});
});
