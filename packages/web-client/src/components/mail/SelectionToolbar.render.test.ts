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

/**
 * The search-escalation states desktop gains in #212: the same offer →
 * counting → escalated → chunked-run flow the mobile sheet carries, driven by
 * the shared derivations in `MessageList`. These assert the toolbar routes each
 * state, never that it re-implements the engine.
 */
describe("SelectionToolbar — search escalation", () => {
	it("renders the select-all-loaded checkbox only when the control is wired", () => {
		assert.equal(mount().query('[aria-label="Select all"]'), null);
		harness?.close();
		harness = undefined;
		const dom = mount({
			selectAll: {
				checked: false,
				indeterminate: true,
				onChange: () => undefined,
			},
		});
		assert.ok(dom.query('[aria-label="Select all"]'));
	});

	it("names the escalated scope through statusLabel instead of a bare count", () => {
		const dom = mount({
			selectedCount: 3412,
			statusLabel: 'All 3,412 matching "npm" selected',
		});
		assert.match(dom.text(), /All 3,412 matching "npm" selected/);
		assert.doesNotMatch(dom.text(), /messages selected/);
	});

	it("hides Delete while the total is still counting, and offers Stop", () => {
		let stopped = 0;
		const dom = mount({
			isCounting: true,
			statusLabel: "Counting… 1,900 so far",
			notice: {
				tone: "info",
				text: "",
				action: {
					label: "Stop",
					onClick: () => {
						stopped += 1;
					},
				},
			},
		});
		assert.equal(dom.query('[aria-label="Delete selected messages"]'), null);
		dom.click(dom.byText("button", "Stop"));
		assert.equal(stopped, 1);
	});

	it("offers the escalation control naming the scope, and escalating fires it", () => {
		let escalated = 0;
		const dom = mount({
			selectAll: { checked: true, onChange: () => undefined },
			notice: {
				tone: "info",
				text: "",
				action: {
					label: 'Select all matching "npm"',
					onClick: () => {
						escalated += 1;
					},
				},
			},
		});
		dom.click(dom.byText("button", 'Select all matching "npm"'));
		assert.equal(escalated, 1);
	});

	it("keeps every verb over an escalated selection — not delete-only (#114)", () => {
		const dom = mount({
			selectedCount: 3412,
			statusLabel: 'All 3,412 matching "npm" selected',
			onMarkAsRead: () => undefined,
			onMove: () => undefined,
			onOrganize: () => undefined,
			accountId: "acc-1",
			currentMailboxId: "mbx-inbox",
			notice: {
				tone: "info",
				text: "",
				action: { label: "Clear selection", onClick: () => undefined },
			},
		});
		assert.ok(dom.query('[aria-label="Mark as read"]'));
		assert.ok(dom.query('[aria-label="Move selected messages"]'));
		assert.ok(dom.query('[aria-label="Delete selected messages"]'));
		// Organize has no escalated-predicate path, so it withdraws once the
		// selection names a scope through statusLabel.
		assert.equal(dom.query('[aria-label="Organize similar messages"]'), null);
	});

	it("shows a progress bar mid-run and takes the verbs off screen", () => {
		const dom = mount({
			selectedCount: 3412,
			statusLabel: "Moving 1,200 of 3,412…",
			onMarkAsRead: () => undefined,
			progress: { value: 1200, max: 3412, tone: "info" },
		});
		assert.ok(dom.query('[role="progressbar"]'));
		assert.equal(dom.query('[aria-label="Delete selected messages"]'), null);
		assert.equal(dom.query('[aria-label="Mark as read"]'), null);
	});

	it("names the succeeded count and retries exactly what is left over", () => {
		let retried = 0;
		const dom = mount({
			selectedCount: 340,
			notice: {
				tone: "danger",
				text: "3,072 moved to Trash. 340 couldn't be deleted.",
				action: {
					label: "Retry 340",
					onClick: () => {
						retried += 1;
					},
				},
			},
		});
		assert.match(
			dom.text(),
			/3,072 moved to Trash\. 340 couldn't be deleted\./,
		);
		dom.click(dom.byText("button", "Retry 340"));
		assert.equal(retried, 1);
	});
});
