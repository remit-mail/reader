// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { makeAccount, makeMailbox } from "../../test-support/fixtures";
import { type HttpMock, mockFetch } from "../../test-support/http";
import { AccountFilters } from "./filters.tsx";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
});

const ACCOUNT_ID = "acc-1";

const account = makeAccount({
	accountId: ACCOUNT_ID,
	folderAppointments: [
		{ role: "Inbox", mailboxId: "mbx-inbox" },
		{ role: "Drafts", mailboxId: "mbx-concepten" },
		{ role: "Sent", mailboxId: "mbx-verzonden" },
		{ role: "Archive", mailboxId: "mbx-archief" },
	],
});

// Dutch leaf names for the appointed Drafts and Sent: only the appointment can
// exclude them, so a name-based filter would not pass this.
const mailboxes = [
	makeMailbox({ mailboxId: "mbx-receipts", fullPath: "INBOX/Receipts" }),
	makeMailbox({ mailboxId: "mbx-concepten", fullPath: "INBOX/Concepten" }),
	makeMailbox({ mailboxId: "mbx-verzonden", fullPath: "INBOX/Verzonden" }),
	makeMailbox({ mailboxId: "mbx-archief", fullPath: "INBOX/Archief" }),
	makeMailbox({ mailboxId: "mbx-inbox", fullPath: "INBOX" }),
];

const filter: RemitImapFilterResponse = {
	filterId: "f-1",
	accountConfigId: ACCOUNT_ID,
	name: "Receipts",
	scope: "Standing",
	state: "Active",
	hasAnchor: false,
	ruleChangedAt: 0,
	actionChangedAt: 0,
	matchOperator: "And",
	literalClauses: [{ field: "From", value: "receipts@stripe.com" }],
	actionLabelId: "None",
	actionMailboxId: "mbx-receipts",
	createdAt: 0,
	updatedAt: 0,
};

/**
 * Wait on the DOM answering rather than on a turn count: how much React work
 * lands per turn varies with the machine, so a fixed flush is a flake and a
 * ceiling is what keeps a surface that never renders a failure, not a hang.
 */
const settleUntil = async (
	dom: DomHarness,
	done: () => boolean,
): Promise<void> => {
	const deadline = Date.now() + 5000;
	for (;;) {
		await dom.flush();
		if (done() || Date.now() >= deadline) return;
		await dom.wait(10);
	}
};

const offeredDestinations = async (): Promise<string[]> => {
	http = mockFetch((call) => {
		if (call.path.endsWith("/mailboxes")) return { items: mailboxes };
		if (call.path.endsWith("/filters")) return { items: [filter] };
		if (call.path.endsWith("/labels")) return { items: [] };
		if (call.path.endsWith("/organize/preview"))
			return { matchedCount: 0, messageIds: [] };
		return {};
	});
	const dom = createDomHarness();
	harness = dom;
	dom.renderApp(createElement(AccountFilters, { account }));
	await settleUntil(
		dom,
		() => !!dom.query('[aria-label="Edit filter Receipts"]'),
	);
	dom.click(dom.byLabel("Edit filter Receipts"));
	await settleUntil(
		dom,
		() => !!dom.query('select[aria-label="Destination folder"]'),
	);
	return dom
		.queryAll<HTMLOptionElement>(
			'select[aria-label="Destination folder"] option',
		)
		.map((option) => option.value)
		.filter((value) => value.startsWith("mbx-"));
};

describe("Settings › Filters — move destinations (#236, #540)", () => {
	it("offers every folder but the appointed Drafts and Sent, in role order", async () => {
		assert.deepEqual(await offeredDestinations(), [
			"mbx-inbox",
			"mbx-archief",
			"mbx-receipts",
		]);
	});
});
