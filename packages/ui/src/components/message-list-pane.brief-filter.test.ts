/**
 * The cross-account brief's account pills reach the panel through the pane that
 * renders the brief, not only through `BriefSections` mounted on its own. The
 * caret has to be pressed for the panel to be up, so this mounts against jsdom
 * rather than `renderToString`.
 */
import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BriefFilterId } from "../lib/brief-filters.js";
import type { ThreadSection } from "./app-shell-types.js";
import type {
	BriefFilterControl,
	BriefFilterSurface,
} from "./brief-sections.js";
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

let container: HTMLElement;
let root: Root;

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

const NO_CHIPS: ReadonlySet<BriefFilterId> = new Set();

/**
 * The pane draws the brief chips and applies none of them, so a host is what
 * makes them do anything — the surface is not optional in the brief mode (#314).
 */
const chipControl: BriefFilterControl = {
	activeFilters: NO_CHIPS,
	onToggleFilter: () => undefined,
	onClearFilters: () => undefined,
};

function mount(briefFilter: BriefFilterSurface = chipControl) {
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
			new MouseEvent("click", { bubbles: true, cancelable: true }),
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
			...chipControl,
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
			...chipControl,
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
		assert.equal(
			unread.getAttribute("aria-pressed"),
			"true",
			"the held chip reads as active",
		);
		const attachment = Array.from(container.querySelectorAll("button")).find(
			(node) => (node.textContent ?? "").trim() === "Has attachment",
		);
		assert.ok(attachment);
		click(attachment);
		assert.equal(toggled, "attachment");
	});
});
