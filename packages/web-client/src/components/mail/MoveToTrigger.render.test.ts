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
		orientation?: "portrait" | "landscape";
		pointer?: "coarse" | "fine";
	} = {},
): DomHarness => {
	harness = createDomHarness({
		viewportWidth: options.viewportWidth,
		orientation: options.orientation,
		pointer: options.pointer,
	});
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

// The desktop picker renders through a portal into document.body, so its
// content sits outside the render container these helpers normally scope to.
const pickerRoot = (dom: DomHarness): ParentNode => {
	const trigger = dom.byLabel("Move to folder");
	return trigger.getAttribute("aria-haspopup") === "dialog"
		? dom.container
		: dom.document.body;
};

const rowText = (dom: DomHarness): string[] =>
	[...pickerRoot(dom).querySelectorAll("[role=treeitem]")].map(
		(row) => row.textContent ?? "",
	);

const pickerText = (dom: DomHarness): string =>
	pickerRoot(dom).textContent ?? "";

const pickerByLabel = (dom: DomHarness, label: string): HTMLElement => {
	const found = pickerRoot(dom).querySelector(`[aria-label="${label}"]`);
	if (!found) throw new Error(`no picker element labelled "${label}"`);
	return found as HTMLElement;
};

const pickerByText = (
	dom: DomHarness,
	selector: string,
	text: string,
): HTMLElement => {
	const found = [...pickerRoot(dom).querySelectorAll(selector)].find((node) =>
		(node.textContent ?? "").includes(text),
	);
	if (!found) throw new Error(`no picker ${selector} containing "${text}"`);
	return found as HTMLElement;
};

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

		dom.click(pickerByLabel(dom, "Move to Work"));
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
		dom.click(pickerByLabel(dom, "Move to Work"));
		assert.deepEqual(moved, []);

		dom.click(pickerByText(dom, "button", "Move to Work"));
		assert.deepEqual(moved, ["mbx-work"]);
		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-expanded"),
			"false",
		);
	});

	it("names the destination on the button that runs the move", () => {
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));
		dom.click(pickerByLabel(dom, "Move to Work"));
		dom.click(pickerByLabel(dom, "Move to Clients"));

		assert.match(pickerText(dom), /Move to Clients/);
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

	it("renders the desktop picker outside its own subtree (#601)", () => {
		// Regression: an in-place absolute popover is clipped by the reading
		// pane's overflow-hidden shell and painted underneath the thread list.
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));

		const trigger = dom.byLabel("Move to folder");
		const tree = pickerRoot(dom).querySelector("[role=tree]");
		assert.ok(tree, "the picker is open");
		assert.ok(
			!trigger.parentElement?.contains(tree),
			"the picker escapes the trigger's subtree via a portal",
		);
	});

	it("stays open when the press lands inside the portalled panel (#601)", () => {
		// The panel is not in the trigger's subtree any more, so the outside-press
		// guard has to recognise it by its own ref — otherwise the first press on
		// a folder closes the picker before it can be picked.
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));

		dom.dispatch(
			pickerByLabel(dom, "Move to Work"),
			new dom.window.MouseEvent("mousedown", { bubbles: true }),
		);

		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-expanded"),
			"true",
		);
	});

	it("takes the keyboard into the picker and hands it back on close", () => {
		// Regression: with the panel on the body, Tab from the trigger walked on
		// to the next toolbar button instead of entering the picker.
		const dom = mount({ mailboxes: FOLDERS });
		dom.click(dom.byLabel("Move to folder"));

		const filter = pickerRoot(dom).querySelector('input[type="search"]');
		assert.ok(filter, "the picker has a filter field");
		assert.equal(dom.document.activeElement, filter);

		dom.dispatch(
			dom.window.document,
			new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
		);
		assert.equal(dom.document.activeElement, dom.byLabel("Move to folder"));
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

	it("opens a dialog on a tablet held upright, which is 1024px wide", () => {
		// Regression: the desktop gate was a bare width, and a large tablet in
		// portrait is exactly 1024px — it got the desktop popover on a touch
		// screen with no room for it.
		const dom = mount({
			mailboxes: FOLDERS,
			viewportWidth: 1024,
			orientation: "portrait",
			pointer: "coarse",
		});
		assert.equal(
			dom.byLabel("Move to folder").getAttribute("aria-haspopup"),
			"dialog",
		);
	});

	it("opens a popover on the same tablet turned sideways", () => {
		const dom = mount({
			mailboxes: FOLDERS,
			viewportWidth: 1024,
			orientation: "landscape",
			pointer: "coarse",
		});
		assert.notEqual(
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
		assert.match(pickerText(dom), /Loading folders/);
	});
});
