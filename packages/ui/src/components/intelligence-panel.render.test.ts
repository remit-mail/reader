import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { categoryLabels, isThreadCategory } from "../category-presentation.js";
import type { IntelligenceCalendarActions } from "./intelligence-calendar.js";
import { inviteWithClash } from "./intelligence-calendar-fixtures.js";
import type {
	IntelligenceData,
	IntelligenceTabId,
} from "./intelligence-panel.js";
import { IntelligencePanel } from "./intelligence-panel.js";

const vipWithFailingAuthenticity: IntelligenceData = {
	sender: {
		name: "Sabrina Basten",
		email: "sabrina@sabrinabasten.example",
		trust: "vip",
		firstSeenLabel: "Mar 2023",
		inboundCount: 214,
		replyCount: 188,
	},
	authenticity: {
		verdict: "mismatch",
		fromDomain: "sabrinabasten.example",
		dkimDomain: "custmx.one.example",
		summary: "Signed by custmx.one.example instead.",
	},
	category: { value: "personal" },
	flags: { vip: true },
};

/** The rendered chip in the Category section. */
function categoryChip(data: IntelligenceData): string {
	const html = renderToString(createElement(IntelligencePanel, { data }));
	const label = categoryLabels[data.category.value];
	const marker = `>${label}</span>`;
	const end = html.indexOf(marker);
	assert.notEqual(end, -1, `expected a chip reading '${label}'`);
	const start = html.lastIndexOf("<span", end);
	return html.slice(start, end + marker.length);
}

describe("IntelligencePanel category chip", () => {
	it("takes its colour from the category, not the authenticity verdict", () => {
		const chip = categoryChip(vipWithFailingAuthenticity);
		assert.doesNotMatch(chip, /danger/);
		assert.match(chip, /text-accent-2/);
	});

	it("renders the same chip for a category whatever the verdict said", () => {
		const failing = categoryChip(vipWithFailingAuthenticity);
		const aligned = categoryChip({
			...vipWithFailingAuthenticity,
			authenticity: {
				verdict: "aligned",
				fromDomain: "sabrinabasten.example",
				summary: "Nothing looks unusual about this sender.",
			},
		});
		assert.equal(failing, aligned);
	});
});

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

function panel(tab: IntelligenceTabId): string {
	return renderToString(
		createElement(IntelligencePanel, {
			data: vipWithFailingAuthenticity,
			calendar: { data: inviteWithClash, actions: inertCalendar },
			tab,
		}),
	);
}

describe("IntelligencePanel tab strip", () => {
	it("offers no strip to a host that wired no calendar", () => {
		const html = renderToString(
			createElement(IntelligencePanel, { data: vipWithFailingAuthenticity }),
		);
		assert.doesNotMatch(html, /radiogroup/);
		assert.match(html, /Authenticity/);
	});

	it("swaps the stack for the calendar rather than stacking both", () => {
		const calendar = panel("calendar");
		assert.match(calendar, /Add to calendar/);
		assert.doesNotMatch(calendar, /Coming soon/);
		assert.doesNotMatch(calendar, /Quick actions/);
	});
});

describe("isThreadCategory", () => {
	it("rejects a category this build has no tone for", () => {
		assert.equal(isThreadCategory("invoice"), false);
		assert.equal(isThreadCategory("Personal"), false);
		assert.equal(isThreadCategory("toString"), false);
	});
});
