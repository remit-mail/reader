/**
 * The bulk-action bar. Two rules govern it: actions are never disabled (they
 * no-op and explain — `doc/rules/ux.md`), and Move/Organize only appear when
 * the selection is inside a single account, because neither works across
 * accounts.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createElement } from "react";
import { createDomHarness, type DomHarness } from "../../test-support/dom";
import { SelectionToolbar } from "./SelectionToolbar";

let harness: DomHarness | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
});

type ToolbarProps = Parameters<typeof SelectionToolbar>[0];

const mount = (props: Partial<ToolbarProps> = {}): DomHarness => {
	harness = createDomHarness();
	harness.renderApp(
		createElement(SelectionToolbar, {
			selectedCount: 2,
			onDelete: () => undefined,
			onClearSelection: () => undefined,
			...props,
		}),
	);
	return harness;
};

describe("SelectionToolbar", () => {
	it("renders nothing while nothing is selected", () => {
		const dom = mount({ selectedCount: 0 });
		assert.equal(dom.html(), "");
	});

	it("counts the selection in words the user reads", () => {
		assert.match(mount({ selectedCount: 1 }).text(), /1 message selected/);
		harness?.close();
		harness = undefined;
		assert.match(mount({ selectedCount: 4 }).text(), /4 messages selected/);
	});

	it("hides Move until both an account and a source mailbox are known", () => {
		const dom = mount({ onMove: () => undefined, accountId: "acc-1" });
		assert.equal(dom.query('[aria-label="Move selected messages"]'), null);
	});

	it("offers Move and Organize once the selection sits in one account", () => {
		const dom = mount({
			onMove: () => undefined,
			onOrganize: () => undefined,
			accountId: "acc-1",
			currentMailboxId: "mbx-inbox",
		});
		assert.ok(dom.query('[aria-label="Move selected messages"]'));
		assert.ok(dom.query('[aria-label="Organize similar messages"]'));
	});

	it("withdraws Organize and explains why when the selection spans accounts", () => {
		const dom = mount({
			onMove: () => undefined,
			onOrganize: () => undefined,
			accountId: "acc-1",
			currentMailboxId: "mbx-inbox",
			moveDisabledHint: "Select messages from one account to move them",
		});
		assert.equal(dom.query('[aria-label="Organize similar messages"]'), null);
		assert.match(dom.text(), /Select messages from one account to move them/);
		assert.match(
			dom.query('[role="status"]')?.textContent ?? "",
			/one account/,
		);
	});

	it("keeps every action pressable while a mutation is in flight (ux.md)", () => {
		const dom = mount({ isDeleting: true, onMarkAsRead: () => undefined });
		for (const button of dom.queryAll<HTMLButtonElement>("button")) {
			assert.equal(button.disabled, false);
		}
		assert.equal(
			dom.byLabel("Delete selected messages").getAttribute("aria-busy"),
			"true",
		);
		assert.match(dom.text(), /Deleting\.\.\./);
	});

	it("no-ops rather than firing a second time while busy", () => {
		let deletes = 0;
		let marks = 0;
		const dom = mount({
			isMoving: true,
			onDelete: () => {
				deletes += 1;
			},
			onMarkAsRead: () => {
				marks += 1;
			},
		});
		dom.click(dom.byLabel("Delete selected messages"));
		dom.click(dom.byLabel("Mark as read"));
		assert.equal(deletes, 0);
		assert.equal(marks, 0);
	});

	it("fires delete, mark-read and clear when idle", () => {
		let cleared = 0;
		let deletes = 0;
		let marks = 0;
		const dom = mount({
			onDelete: () => {
				deletes += 1;
			},
			onClearSelection: () => {
				cleared += 1;
			},
			onMarkAsRead: () => {
				marks += 1;
			},
		});
		dom.click(dom.byLabel("Delete selected messages"));
		dom.click(dom.byLabel("Mark as read"));
		dom.click(dom.byLabel("Clear selection"));
		assert.deepEqual([deletes, marks, cleared], [1, 1, 1]);
	});

	it("opens the organize flow for the current selection", () => {
		let organized = 0;
		const dom = mount({
			onMove: () => undefined,
			accountId: "acc-1",
			currentMailboxId: "mbx-inbox",
			onOrganize: () => {
				organized += 1;
			},
		});
		dom.click(dom.byLabel("Organize similar messages"));
		assert.equal(organized, 1);
	});
});
