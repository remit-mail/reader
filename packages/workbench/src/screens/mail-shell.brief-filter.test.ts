/**
 * The brief's filter selection is the shell's, not each surface's: the panel the
 * caret opens over the rows and the phone search takeover that covers them read
 * one set, so a chip set on either is set on both. Mounted against jsdom — the
 * point is what survives pressing things.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	briefSections,
	briefUnseen,
	personalId,
	workId,
} from "../fixtures/workspace.js";
import { MailShell } from "./mail-shell.js";

const DESKTOP_WIDTH = 1440;
const PHONE_WIDTH = 390;

let container: HTMLElement;
let root: Root;

before(async () => {
	// The kit's `.tsx` sits outside this package's tsconfig, so the runner
	// transpiles it with the classic JSX runtime, which reads a global `React`.
	// Storybook and the app both use the automatic runtime.
	(globalThis as { React?: typeof React }).React = React;
});

beforeEach(() => {
	container = document.getElementById("root") as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

function mount(width: number) {
	act(() => {
		root.render(
			createElement(MailShell, {
				width,
				selectedNavId: "brief",
				listTitle: "Daily brief",
				unreadCount: briefUnseen,
				sections: briefSections(),
				briefFilters: true,
			}),
		);
	});
}

/** The subject of the first row of each account, to tick one of each. */
function subjectPerAccount(): [string, string] {
	const threads = briefSections().flatMap((section) => section.threads);
	const first = (accountId: string) =>
		threads.find((thread) => thread.accountId === accountId)?.subject;
	const personal = first(personalId);
	const work = first(workId);
	assert.ok(personal && work, "the fixture spans both accounts");
	return [personal, work];
}

function click(element: Element, metaKey = false) {
	act(() => {
		element.dispatchEvent(
			new MouseEvent("click", {
				bubbles: true,
				cancelable: true,
				metaKey,
			}),
		);
	});
}

function row(subject: string): HTMLElement {
	const found = Array.from(
		container.querySelectorAll<HTMLElement>("[data-list-row]"),
	).find((node) => (node.textContent ?? "").includes(subject));
	assert.ok(found, `no row reading "${subject}"`);
	return found;
}

function byLabel(label: string): HTMLElement {
	const found = container.querySelector(`[aria-label="${label}"]`);
	assert.ok(found, `no control labelled "${label}"`);
	return found as HTMLElement;
}

/** A pill inside one of the filter panel's named groups. */
function pill(group: string, text: string): HTMLElement {
	const row = container.querySelector(`[aria-label="${group}"]`);
	assert.ok(row, `the panel has no "${group}" row`);
	const found = Array.from(row.querySelectorAll("button")).find((node) =>
		(node.textContent ?? "").trim().startsWith(text),
	);
	assert.ok(found, `no ${group} pill reading "${text}"`);
	return found;
}

function isActive(element: Element): boolean {
	return element.getAttribute("aria-pressed") === "true";
}

function selectionCount(): string {
	const bar = container.querySelector("[data-selection-count]");
	return bar ? (bar.textContent ?? "") : "";
}

function rowCount(): number {
	return container.querySelectorAll("[data-list-row]").length;
}

describe("the brief's account pills", () => {
	it("are in the panel the list header's caret opens", () => {
		mount(DESKTOP_WIDTH);
		assert.equal(container.querySelector('[aria-label="Accounts"]'), null);
		click(byLabel("Expand filters"));
		assert.ok(
			isActive(pill("Accounts", "All")),
			"the aggregate is the default scope",
		);
		assert.ok(pill("Accounts", "Personal"));
		assert.ok(pill("Accounts", "Work"));
		assert.match(
			container.textContent ?? "",
			/\+1 muted/,
			"the muted account is counted rather than offered",
		);
	});

	it("segment the rows they name", () => {
		mount(DESKTOP_WIDTH);
		click(byLabel("Expand filters"));
		const aggregate = rowCount();
		click(pill("Accounts", "Work"));
		assert.ok(isActive(pill("Accounts", "Work")));
		assert.ok(rowCount() > 0, "the work account still has rows");
		assert.ok(rowCount() < aggregate, "and fewer of them than the aggregate");
	});

	it("drop the ticked rows they hide from the selection", () => {
		mount(DESKTOP_WIDTH);
		click(byLabel("Expand filters"));
		const [personal, work] = subjectPerAccount();
		click(row(personal), true);
		click(row(work), true);
		assert.match(selectionCount(), /2 messages selected/);

		click(pill("Accounts", "Work"));
		assert.match(
			selectionCount(),
			/1 message selected/,
			"a verb acts on the rows that are still on screen",
		);
	});
});

describe("the brief's attribute chips", () => {
	it("hold across the panel and the phone search takeover", () => {
		mount(PHONE_WIDTH);
		click(byLabel("Expand filters"));
		click(pill("Attributes", "Unread"));
		assert.ok(
			isActive(pill("Attributes", "Unread")),
			"the chip is on in the panel",
		);

		click(byLabel("Search"));
		assert.ok(
			isActive(pill("Attributes", "Unread")),
			"the takeover opens on the same selection",
		);
		assert.ok(pill("Accounts", "Work"), "and offers the same accounts");

		click(pill("Attributes", "Has attachment"));
		click(byLabel("Clear and close search"));
		assert.ok(isActive(pill("Attributes", "Unread")));
		assert.ok(
			isActive(pill("Attributes", "Has attachment")),
			"and a chip set in the takeover is on back in the panel",
		);
	});
});

describe("the brief's filter panel", () => {
	it("is still up on the other side of the search takeover", () => {
		mount(PHONE_WIDTH);
		click(byLabel("Expand filters"));
		click(byLabel("Search"));
		assert.ok(
			container.querySelector('[aria-label="Attributes"]'),
			"the takeover opens on the panel the list left open",
		);

		click(byLabel("Collapse filters"));
		click(byLabel("Clear and close search"));
		assert.equal(
			container.querySelector('[aria-label="Attributes"]'),
			null,
			"and closing it there closes it back on the list",
		);
	});
});
