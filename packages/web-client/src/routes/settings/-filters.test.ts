// biome-ignore lint/style/useFilenamingConvention: TanStack Router convention
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";
import { MailboxSyncStatus } from "@remit/domain-enums";
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
// exclude them, so a name-based filter would not pass this. `Receipts` renamed
// to `Bonnetjes`, and a second `Receipts` inside Travel, are what the
// destination has to read and nest correctly.
const mailboxes = [
	makeMailbox({
		mailboxId: "mbx-receipts",
		fullPath: "INBOX/Receipts",
		displayNameOverride: "Bonnetjes",
	}),
	makeMailbox({ mailboxId: "mbx-concepten", fullPath: "INBOX/Concepten" }),
	makeMailbox({ mailboxId: "mbx-verzonden", fullPath: "INBOX/Verzonden" }),
	makeMailbox({ mailboxId: "mbx-archief", fullPath: "INBOX/Archief" }),
	makeMailbox({ mailboxId: "mbx-inbox", fullPath: "INBOX" }),
	makeMailbox({ mailboxId: "mbx-travel", fullPath: "INBOX/Travel" }),
	makeMailbox({
		mailboxId: "mbx-travel-receipts",
		fullPath: "INBOX/Travel/Receipts",
	}),
];

const createdFolder = makeMailbox({
	mailboxId: "mbx-created",
	fullPath: "INBOX/Travel/Hotels",
	syncStatus: MailboxSyncStatus.synced,
});

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

const rowLabels = (dom: DomHarness): string[] =>
	dom
		.queryAll("[role=treeitem]")
		.map((row) => row.getAttribute("aria-label") ?? "");

const buttonWithText = (
	dom: DomHarness,
	text: string,
): HTMLElement | undefined =>
	dom
		.queryAll<HTMLButtonElement>("button")
		.find((button) => button.textContent?.trim() === text);

/** The create form's name field, found by the label the kit gives it. */
const folderNameField = (dom: DomHarness): HTMLInputElement | undefined => {
	const label = dom
		.queryAll<HTMLLabelElement>("label")
		.find((node) => node.textContent?.trim() === "Folder name");
	const id = label?.getAttribute("for");
	return id
		? ((dom.query(`input[id="${id}"]`) as HTMLInputElement | null) ?? undefined)
		: undefined;
};

/**
 * Opens the filter for editing and asks its destination field for the tree. The
 * filter already moves matches into `INBOX/Receipts`, so the tree opens on the
 * branch holding it.
 */
const openDestinationTree = async (
	posted?: Record<string, unknown>[],
): Promise<DomHarness> => {
	const live = [...mailboxes];
	http = mockFetch((call) => {
		if (call.path.endsWith("/mailboxes") && call.method === "POST") {
			posted?.push(call.body ?? {});
			live.push(createdFolder);
			return createdFolder;
		}
		if (call.path.endsWith("/mailboxes")) return { items: live };
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
	await settleUntil(dom, () => !!buttonWithText(dom, "Choose a folder"));
	const choose = buttonWithText(dom, "Choose a folder");
	assert.ok(choose, "the destination field offers the folder tree");
	dom.click(choose);
	await settleUntil(dom, () => rowLabels(dom).length > 0);
	return dom;
};

const openFolder = async (dom: DomHarness, label: string): Promise<void> => {
	dom.click(dom.byLabel(`Move to ${label}`));
	await dom.flush();
};

describe("Settings › Filters — move destination (#236, #540, #549)", () => {
	it("offers every folder but the appointed Drafts and Sent", async () => {
		const dom = await openDestinationTree();
		assert.deepEqual(rowLabels(dom), [
			"Move to INBOX",
			"Move to Archief",
			"Move to Bonnetjes",
			"Move to Travel",
		]);
	});

	it("reads a renamed folder as the name the account gave it", async () => {
		const dom = await openDestinationTree();
		assert.ok(rowLabels(dom).includes("Move to Bonnetjes"));
		assert.ok(
			!rowLabels(dom).some((label) => label.includes("Receipts")),
			"the provider leaf is never what the row reads as",
		);
	});

	it("nests a folder under the one holding it", async () => {
		const dom = await openDestinationTree();
		await openFolder(dom, "Travel");
		const nested = dom
			.queryAll("[role=treeitem]")
			.filter((row) => row.getAttribute("aria-label") === "Move to Receipts");
		assert.equal(nested.length, 1);
		assert.equal(nested[0].getAttribute("aria-level"), "3");
	});

	it("creates a folder inside the one the tree is looking at", async () => {
		const posted: Record<string, unknown>[] = [];
		const dom = await openDestinationTree(posted);
		await openFolder(dom, "Travel");
		dom.click(dom.byLabel("New folder inside Travel"));
		await dom.flush();
		const name = folderNameField(dom);
		assert.ok(name, "the folder name field is on screen");
		dom.type(name, "Hotels");
		const create = buttonWithText(dom, "Create folder");
		assert.ok(create, "the create button is on screen");
		dom.click(create);
		await settleUntil(dom, () => posted.length > 0);
		assert.deepEqual(posted, [
			{ fullPath: "INBOX/Travel/Hotels", namespaceType: "personal" },
		]);
	});
});
