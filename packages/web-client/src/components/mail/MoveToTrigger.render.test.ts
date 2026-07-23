/**
 * The move-to-folder picker. It only fetches folders once it is opened, it
 * marks the folder the messages are already in rather than offering it as a
 * destination, and on desktop Escape or a click outside puts it away.
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
	makeMailbox({ mailboxId: "mbx-receipts", fullPath: "Receipts" }),
];

describe("MoveToTrigger", () => {
	it("reports itself as collapsed until it is opened", () => {
		const dom = mount({ mailboxes: FOLDERS });
		const trigger = dom.byLabel("Move to folder");
		assert.equal(trigger.getAttribute("aria-expanded"), "false");
		assert.equal(trigger.getAttribute("aria-controls"), null);
		assert.equal(dom.query('[role="listbox"], input'), null);
	});

	it("opens a listbox of destinations and marks the folder we are in", () => {
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));

		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-expanded"),
			"true",
		);
		const labels = dom
			.queryAll("[role=option]")
			.map((option) => option.textContent ?? "");
		assert.ok(labels.some((label) => label.includes("Work")));
		assert.ok(labels.some((label) => label.includes("Receipts")));

		// The folder the messages are already in stays in the list, marked as
		// where they are now rather than presented as somewhere to move them.
		const current = labels.find((label) => label.includes("current"));
		assert.ok(current, "the source folder is marked as the current one");
	});

	it("moves to the folder the user picks and closes itself", () => {
		const moved: string[] = [];
		const dom = mount({
			mailboxes: FOLDERS,
			onMove: (id) => moved.push(id),
		});
		dom.click(dom.byLabel("Move to folder"));
		dom.click(dom.byText("[role=option]", "Work"));

		assert.deepEqual(moved, ["mbx-work"]);
		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-expanded"),
			"false",
		);
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
		assert.equal(dom.queryAll("[role=option]").length, 0);
		dom.click(dom.byLabel("Move to folder"));
		// No cached mailboxes and no network in the test harness: the picker
		// shows its loading state rather than an empty list of destinations.
		assert.match(dom.text(), /Loading folders/);
	});
});
