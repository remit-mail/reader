/**
 * The strip against each host shape. A host that only wants to hear about the
 * change — it passes `onTabChange` and no `tab` — still has to see the strip
 * move, or the panel is stuck on whatever it opened with.
 */

import "@remit/test-dom";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IntelligenceCalendarActions } from "./intelligence-calendar.js";
import { inviteWithClash } from "./intelligence-calendar-fixtures.js";
import {
	type IntelligenceData,
	IntelligencePanel,
	type IntelligenceTabId,
} from "./intelligence-panel.js";

const sender: IntelligenceData = {
	sender: {
		name: "Priya Natarajan",
		email: "priya@northwind.example",
		trust: "wellknown",
		firstSeenLabel: "Jan 2024",
		inboundCount: 41,
		replyCount: 29,
	},
	authenticity: {
		verdict: "aligned",
		fromDomain: "northwind.example",
		summary: "Nothing looks unusual about this sender.",
	},
	category: { value: "personal" },
	flags: {},
	similar: [],
};

const inertCalendar: IntelligenceCalendarActions = {
	onAddInvite: () => undefined,
	onTentativeInvite: () => undefined,
	onDeclineInvite: () => undefined,
	onReopenInvite: () => undefined,
	onOfferOtherTimes: () => undefined,
	onRemoveInvite: () => undefined,
	onOpenNewerInvite: () => undefined,
	onToggleSlot: () => undefined,
	onAddSuggestion: () => undefined,
	onReviewSuggestion: () => undefined,
	onDismissSuggestion: () => undefined,
	onOpenThread: () => undefined,
	onSelectEvent: () => undefined,
};

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

function mount(props: {
	tab?: IntelligenceTabId;
	onTabChange?: (next: IntelligenceTabId) => void;
}) {
	act(() => {
		root.render(
			createElement(IntelligencePanel, {
				data: sender,
				calendar: { data: inviteWithClash, actions: inertCalendar },
				...props,
			}),
		);
	});
}

function pickTab(label: string) {
	const segment = Array.from(container.querySelectorAll("label")).find(
		(candidate) => candidate.textContent?.includes(label),
	);
	assert.ok(segment, `no segment reading ${label}`);
	const radio = segment.querySelector("input");
	assert.ok(radio, "the segment carries no radio to press");
	act(() => {
		radio.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

function showingCalendar(): boolean {
	return container.textContent?.includes("Add to calendar") ?? false;
}

describe("the tab strip", () => {
	it("moves for a host that listens but holds no tab of its own", () => {
		const heard: IntelligenceTabId[] = [];
		mount({ onTabChange: (next) => heard.push(next) });

		assert.equal(showingCalendar(), false);
		pickTab("Calendar");

		assert.deepEqual(heard, ["calendar"]);
		assert.equal(showingCalendar(), true);
	});

	it("moves for a host that neither holds nor listens", () => {
		mount({});

		pickTab("Calendar");

		assert.equal(showingCalendar(), true);
	});

	it("leaves the tab to a host that holds it", () => {
		const heard: IntelligenceTabId[] = [];
		mount({ tab: "sender", onTabChange: (next) => heard.push(next) });

		pickTab("Calendar");

		assert.deepEqual(heard, ["calendar"]);
		assert.equal(
			showingCalendar(),
			false,
			"a controlled panel moves only when its host says so",
		);
	});
});

describe("two panels on one page", () => {
	it("group their radios apart, so answering one never clears the other", () => {
		const second = document.createElement("div");
		document.body.appendChild(second);
		const secondRoot = createRoot(second);
		mount({});
		act(() => {
			secondRoot.render(
				createElement(IntelligencePanel, {
					data: sender,
					calendar: { data: inviteWithClash, actions: inertCalendar },
				}),
			);
		});

		const names = [container, second].map((host) =>
			host.querySelector("input")?.getAttribute("name"),
		);

		assert.ok(names[0]);
		assert.notEqual(names[0], names[1]);

		act(() => {
			secondRoot.unmount();
		});
		second.remove();
	});
});
