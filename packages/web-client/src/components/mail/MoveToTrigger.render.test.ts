/**
 * The move-to-folder picker. It only fetches folders once it is opened, it
 * opens on the account's top level with nested folders behind the one holding
 * them, it marks the folder the messages are already in rather than offering it
 * as a destination, and on desktop Escape or a click outside puts it away.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMailboxResponse } from "@remit/api-http-client/types.gen.ts";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { makeMailbox } from "../../test-support/fixtures";
import { MoveToTrigger } from "./MoveToTrigger";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

const ACCOUNT_ID = "acc-1";

const mount = (
	options: {
		mailboxes?: RemitImapMailboxResponse[];
		currentMailboxId?: string;
		disabledHint?: string;
		onMove?: (destinationMailboxId: string) => void;
		viewportWidth?: number;
	} = {},
): DomHarness => {
	harness = createDomHarness({ viewportWidth: options.viewportWidth });
	if (options.mailboxes) {
		harness.queryClient.setQueryData(
			mailboxOperationsListMailboxesQueryKey({
				path: { accountId: ACCOUNT_ID },
			}),
			{ items: options.mailboxes },
		);
	}
	harness.renderApp(
		createElement(MoveToTrigger, {
			accountId: ACCOUNT_ID,
			currentMailboxId: options.currentMailboxId ?? "mbx-inbox",
			onMove: options.onMove ?? (() => undefined),
			disabledHint: options.disabledHint,
		}),
	);
	return harness;
};

const FOLDERS = [
	makeMailbox({ mailboxId: "mbx-inbox", fullPath: "INBOX" }),
	makeMailbox({ mailboxId: "mbx-work", fullPath: "Work" }),
	makeMailbox({ mailboxId: "mbx-clients", fullPath: "Work/Clients" }),
	makeMailbox({ mailboxId: "mbx-receipts", fullPath: "Receipts" }),
];

const rowText = (dom: DomHarness): string[] =>
	dom.queryAll("[role=treeitem]").map((row) => row.textContent ?? "");

describe("MoveToTrigger", () => {
	it("reports itself as collapsed until it is opened", () => {
		const dom = mount({ mailboxes: FOLDERS });
		const trigger = dom.byLabel("Move to folder");
		assert.equal(trigger.getAttribute("aria-expanded"), "false");
		assert.equal(trigger.getAttribute("aria-controls"), null);
		assert.equal(dom.query('[role="tree"], input'), null);
	});

	it("opens the top level and marks the folder we are in", () => {
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));

		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-expanded"),
			"true",
		);
		const labels = rowText(dom);
		assert.ok(labels.some((label) => label.includes("Work")));
		assert.ok(labels.some((label) => label.includes("Receipts")));

		// The folder the messages are already in stays in the list, marked as
		// where they are now rather than presented as somewhere to move them.
		const current = labels.find((label) => label.includes("current"));
		assert.ok(current, "the source folder is marked as the current one");
	});

	it("keeps a nested folder behind the folder that holds it", () => {
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));
		assert.equal(
			rowText(dom).some((label) => label.includes("Clients")),
			false,
		);

		dom.click(dom.byLabel("Move to Work"));
		assert.ok(rowText(dom).some((label) => label.includes("Clients")));
	});

	it("waits for the move to be confirmed, then closes itself", () => {
		const moved: string[] = [];
		const dom = mount({
			mailboxes: FOLDERS,
			onMove: (id) => moved.push(id),
		});
		dom.click(dom.byLabel("Move to folder"));

		// Picking a folder also opens it, so the move is a separate press —
		// otherwise the first tap would fire before anything nested was reachable.
		dom.click(dom.byLabel("Move to Work"));
		assert.deepEqual(moved, []);

		dom.click(dom.byText("button", "Move to Work"));
		assert.deepEqual(moved, ["mbx-work"]);
		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-expanded"),
			"false",
		);
	});

	it("names the destination on the button that runs the move", () => {
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));
		dom.click(dom.byLabel("Move to Work"));
		dom.click(dom.byLabel("Move to Clients"));

		assert.match(dom.text(), /Move to Clients/);
	});

	it("closes on Escape and on a click outside it", () => {
		const dom = mount({ mailboxes: FOLDERS });
		const isOpen = () =>
			dom.byLabel("Move to folder").getAttribute("aria-expanded") === "true";

		dom.click(dom.byLabel("Move to folder"));
		assert.equal(isOpen(), true);
		dom.dispatch(
			dom.window.document,
			new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
		);
		assert.equal(isOpen(), false);

		dom.click(dom.byLabel("Move to folder"));
		assert.equal(isOpen(), true);
		dom.dispatch(
			dom.window.document.body,
			new dom.window.MouseEvent("mousedown", { bubbles: true }),
		);
		assert.equal(isOpen(), false);
	});

	/**
	 * Issue #601: the picker was drawn inside the reading pane, and every pane of
	 * the shell clips its content, so the panel was cut off at the pane's edge
	 * and the thread list beside it covered the rest. The panel now hangs off the
	 * trigger from the document, which is the only place it can overlap a
	 * neighbouring pane.
	 */
	it("draws the open picker outside the pane that would clip it", () => {
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));

		const rows = dom.queryAll("[role=treeitem]");
		assert.ok(rows.length > 0, "the folder list is open");
		for (const row of rows) {
			assert.equal(
				dom.container.contains(row),
				false,
				"a folder row inside the pane subtree is a row the pane can clip",
			);
		}
	});

	it("refuses to open, and says why, when the selection spans accounts", () => {
		const hint = "Select messages from one account to move them";
		const dom = mount({ mailboxes: FOLDERS, disabledHint: hint });
		const trigger = dom.byLabel("Move to folder");
		assert.equal(trigger.getAttribute("title"), hint);

		dom.click(trigger);
		assert.equal(trigger.getAttribute("aria-expanded"), "false");
	});

	it("opens a dialog rather than a popover on a phone", () => {
		const dom = mount({ mailboxes: FOLDERS, viewportWidth: 390 });
		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-haspopup"),
			"dialog",
		);
	});

	it("asks for the folder list only once the picker is opened", () => {
		const dom = mount();
		assert.equal(dom.queryAll("[role=treeitem]").length, 0);
		dom.click(dom.byLabel("Move to folder"));
		// No cached mailboxes and no network in the test harness: the picker
		// shows its loading state rather than an empty list of destinations.
		assert.match(dom.text(), /Loading folders/);
	});
});
