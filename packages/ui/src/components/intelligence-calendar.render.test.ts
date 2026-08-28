import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	IntelligenceCalendar,
	type IntelligenceCalendarActions,
	type IntelligenceCalendarData,
} from "./intelligence-calendar.js";
import {
	cancelledInvite,
	flightConfirmation,
	inviteWithClash,
	inviteWithoutClash,
	nothingAboutTime,
	proseTimeThread,
	supersededInvite,
} from "./intelligence-calendar-fixtures.js";

const inert: IntelligenceCalendarActions = {
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

function render(data: IntelligenceCalendarData): string {
	return renderToString(
		createElement(IntelligenceCalendar, { data, actions: inert }),
	);
}

describe("the calendar tab states the cost before the answer", () => {
	it("names every clash above the button that would accept the invitation", () => {
		const html = render(inviteWithClash);
		const clash = html.indexOf("Dentist");
		const accept = html.indexOf("Add to calendar");
		assert.notEqual(clash, -1, "expected the clashing event to be named");
		assert.notEqual(accept, -1, "expected the accept button");
		assert.ok(clash < accept, "the clash must be stated before the answer");
	});

	it("says the day is clear rather than saying nothing", () => {
		assert.match(render(inviteWithoutClash), /Nothing else is booked over it/);
	});
});

describe("the calendar tab never implies a reply was sent", () => {
	it("states that the organiser is not notified beside the button", () => {
		assert.match(render(inviteWithClash), /is not notified/);
	});

	it("keeps saying so once the event is on the calendar", () => {
		const answered: IntelligenceCalendarData = {
			...inviteWithClash,
			invite: inviteWithClash.invite && {
				...inviteWithClash.invite,
				rsvp: "accepted",
			},
		};
		const html = render(answered);
		assert.match(html, /was not notified/);
		assert.doesNotMatch(html, /Add to calendar/);
	});
});

describe("an invitation that has been overtaken", () => {
	it("offers the newer revision instead of an answer to the stale one", () => {
		const html = render(supersededInvite);
		assert.match(html, /has sent a newer version of this/);
		assert.match(html, /Open the newer invitation/);
		assert.doesNotMatch(html, /Add to calendar/);
	});

	it("leaves a cancellation on the calendar until the reader acts", () => {
		const html = render(cancelledInvite);
		assert.match(html, /cancelled this/);
		assert.match(html, /still on your calendar/);
		assert.match(html, /Remove from calendar/);
	});
});

describe("readings that are not invitations", () => {
	it("spells out where the confirming press lands", () => {
		assert.match(render(flightConfirmation), /Add to calendar/);
	});

	it("asks which clock before it will take a zoneless time", () => {
		assert.match(render(flightConfirmation), /Which clock is this on/);
	});
});

describe("times named in prose", () => {
	it("marks each named hour against what is already booked", () => {
		const html = render(proseTimeThread);
		assert.match(html, /Support rotation review/);
		assert.match(html, /Design review/);
		assert.match(html, /Nothing booked/);
	});

	it("offers the free half-hours as things to hand back", () => {
		assert.match(render(proseTimeThread), /15:15/);
	});
});

describe("a message with no time in it", () => {
	it("says so rather than rendering an empty frame", () => {
		assert.match(
			render(nothingAboutTime),
			/Nothing in this message is about a time/,
		);
	});
});
