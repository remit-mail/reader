/**
 * The cross-account brief's account pills reach the panel through the pane that
 * renders the brief, not only through `BriefSections` mounted on its own. The
 * caret has to be pressed for the panel to be up, so this mounts against jsdom
 * rather than `renderToString`.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import type { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ThreadSection } from "./app-shell-types.js";
import type { BriefFilterSurface } from "./brief-sections.js";
import { MessageListPane } from "./message-list-pane.js";

const sections: ThreadSection[] = [
	{
		id: "personal",
		label: "Personal",
		threads: [
			{
				id: "t1",
				accountId: "acc_personal",
				fromName: "Priya Nair",
				fromEmail: "priya@example.com",
				subject: "Design review tomorrow",
				snippet: "Can we move it to 2pm?",
				timeLabel: "8:15",
				isRead: false,
				category: "personal",
			},
		],
	},
];

const sources = [
	{ id: "all", label: "All", active: true },
	{ id: "acc_personal", label: "Personal", count: 4 },
	{ id: "acc_work", label: "Work", count: 7 },
];

let dom: JSDOM;
let container: HTMLElement;
let root: Root;

before(async () => {
	const { JSDOM: JSDOMCtor } = await import("jsdom");
	dom = new JSDOMCtor(
		"<!doctype html><html><body><div id=root></div></body></html>",
		{ url: "http://localhost/", pretendToBeVisual: true },
	);
	globalThis.window = dom.window as unknown as typeof globalThis.window;
	globalThis.document = dom.window.document;
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Element = dom.window.Element;
	globalThis.MouseEvent = dom.window.MouseEvent;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = true;
});

after(() => {
	dom.window.close();
});

beforeEach(() => {
	container = dom.window.document.getElementById(
		"root",
	) as unknown as HTMLElement;
	container.innerHTML = "";
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
});

function mount(briefFilter?: BriefFilterSurface) {
	act(() => {
		root.render(
			createElement(MessageListPane, {
				listTitle: "Daily brief",
				sections,
				briefFilters: true,
				isDesktop: true,
				briefFilter,
			}),
		);
	});
}

function click(element: Element) {
	act(() => {
		element.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
}

function openPanel() {
	const caret = container.querySelector('[aria-label="Expand filters"]');
	assert.ok(caret, "the pane offers a way to open the filter panel");
	click(caret);
}

function labels(selector: string): string[] {
	return Array.from(container.querySelectorAll(selector)).map((node) =>
		(node.textContent ?? "").trim(),
	);
}

describe("the brief's filter panel inside the message list pane", () => {
	it("carries the account pills and the muted note it is given", () => {
		mount({
			sources,
			sourcesNote: "+1 muted",
			onSelectSource: () => undefined,
		});
		openPanel();
		const pills = labels("button");
		assert.ok(
			pills.includes("Personal4"),
			"a pill per account, with its count",
		);
		assert.ok(pills.includes("Work7"));
		assert.match(container.textContent ?? "", /\+1 muted/);
	});

	it("reports the pill the user picks", () => {
		let picked: string | undefined;
		mount({
			sources,
			onSelectSource: (id) => {
				picked = id;
			},
		});
		openPanel();
		const work = Array.from(container.querySelectorAll("button")).find(
			(node) => (node.textContent ?? "").trim() === "Work7",
		);
		assert.ok(work);
		click(work);
		assert.equal(picked, "acc_work");
	});

	it("offers no source row without pills", () => {
		mount();
		openPanel();
		assert.doesNotMatch(container.textContent ?? "", /Work/);
	});

	it("draws the chips the caller holds and reports a toggle", () => {
		let toggled: string | undefined;
		mount({
			sources,
			activeFilters: new Set(["unread"]),
			onToggleFilter: (id) => {
				toggled = id;
			},
			onClearFilters: () => undefined,
		});
		openPanel();
		const unread = Array.from(container.querySelectorAll("button")).find(
			(node) => (node.textContent ?? "").trim() === "Unread",
		);
		assert.ok(unread);
		assert.match(unread.className, /accent-2/, "the held chip reads as active");
		const attachment = Array.from(container.querySelectorAll("button")).find(
			(node) => (node.textContent ?? "").trim() === "Has attachment",
		);
		assert.ok(attachment);
		click(attachment);
		assert.equal(toggled, "attachment");
	});
});
