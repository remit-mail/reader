import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
	CalendarInviteCard,
	type CalendarInviteCardProps,
} from "./calendar-invite-card.js";
import {
	dentistClash,
	kickoffInvite,
} from "./intelligence-calendar-fixtures.js";

const base: CalendarInviteCardProps = {
	invite: kickoffInvite,
	whenText: "Thursday 11 June, 14:00 – 15:00",
	calendarName: "Work",
	color: "cal-2",
	clashes: dentistClash,
	rsvp: "noReply",
	onAdd: () => undefined,
	onTentative: () => undefined,
	onDecline: () => undefined,
	onReopen: () => undefined,
	onOfferOtherTimes: () => undefined,
};

const render = (props: Partial<CalendarInviteCardProps> = {}) =>
	renderToString(createElement(CalendarInviteCard, { ...base, ...props }));

describe("CalendarInviteCard", () => {
	it("names the organiser, the calendar and the span", () => {
		const html = render();
		assert.match(html, /Priya Natarajan/);
		assert.match(html, /Work/);
		assert.match(html, /Thursday 11 June, 14:00 – 15:00/);
		assert.match(html, /Billing migration kickoff/);
	});

	it("states the clash above the button that would accept it", () => {
		const html = render();
		const clash = html.indexOf("Dentist");
		const accept = html.indexOf("Add to calendar");
		assert.notEqual(clash, -1);
		assert.notEqual(accept, -1);
		assert.ok(clash < accept, "the clash must be stated before the answer");
	});

	it("says which rung of the ladder read the invitation", () => {
		assert.match(render(), /Attached invitation/);
		assert.match(
			render({ invite: { ...kickoffInvite, method: "pattern" } }),
			/Read from the words/,
		);
	});

	it("never implies a reply was sent, before or after the answer", () => {
		assert.match(render(), /is not notified/);
		assert.match(render({ rsvp: "accepted" }), /was not notified/);
	});

	it("counts the guests by what they answered", () => {
		assert.match(render(), /2 coming · 1 maybe · 1 no reply/);
	});

	it("takes a host's own guest surface instead of the tally", () => {
		const html = render({ guests: createElement("p", null, "Three of four") });
		assert.match(html, /Three of four/);
		assert.doesNotMatch(html, /guests/);
	});

	it("offers the newer revision rather than an answer to a stale one", () => {
		const html = render({
			invite: { ...kickoffInvite, state: "superseded", sequence: 1 },
			onOpenNewer: () => undefined,
		});
		assert.match(html, /has sent a newer version of this/);
		assert.match(html, /Open the newer invitation/);
		assert.doesNotMatch(html, /Add to calendar/);
	});

	it("leaves a cancellation on the calendar until the reader acts", () => {
		const html = render({
			invite: { ...kickoffInvite, state: "cancelled", sequence: 2 },
			rsvp: "accepted",
			onRemove: () => undefined,
		});
		assert.match(html, /cancelled this/);
		assert.match(html, /Nothing comes off it until you say so/);
		assert.match(html, /Remove from calendar/);
	});

	it("drops the clash check for an invitation that is no longer the question", () => {
		assert.doesNotMatch(
			render({ invite: { ...kickoffInvite, state: "superseded" } }),
			/Dentist/,
		);
	});

	it("offers other times to someone who has already declined", () => {
		const html = render({ rsvp: "declined" });
		assert.match(html, /You declined/);
		assert.match(html, /Offer other times/);
	});

	it("gives a thumb targets it can hit", () => {
		assert.match(render({ touch: true }), /min-h-11/);
		assert.doesNotMatch(render(), /min-h-11/);
	});

	it("leaves off the answers the host cannot store", () => {
		const html = render({ onTentative: undefined, onReopen: undefined });
		assert.doesNotMatch(html, />Maybe</);
		assert.doesNotMatch(
			render({ rsvp: "accepted", onReopen: undefined }),
			/>Change</,
		);
	});

	it("names the sender the mute rule matches, not the organiser", () => {
		assert.doesNotMatch(render(), /Stop offering invitations/);
		const html = render({
			mute: { sender: "Alex Forwarder", onMute: () => undefined },
		});
		assert.match(html, /Stop offering invitations from Alex Forwarder/);
		assert.doesNotMatch(html, /Stop offering invitations from Priya/);
	});

	it("states an answer that did not land, with the way to report it", () => {
		const html = render({
			failure: "The calendar refused it.",
			reportHref: "https://example.invalid/issues/new",
		});
		assert.match(html, /role="alert"/);
		assert.match(html, /The calendar refused it\./);
		assert.match(html, /href="https:\/\/example\.invalid\/issues\/new"/);
		assert.match(html, /Report an issue/);
	});

	it("holds only the answers that write, when there is no calendar to write to", () => {
		const html = render({
			addBlocked: "You have no calendar yet.",
			mute: { sender: "Alex", onMute: () => undefined },
		});
		assert.match(html, /You have no calendar yet\./);
		const before = (label: string) => {
			const upTo = html.slice(0, html.indexOf(label));
			return upTo.slice(upTo.lastIndexOf("<button"));
		};
		assert.match(before("Add to calendar"), /disabled=""/);
		assert.doesNotMatch(before("Decline"), /disabled=""/);
		assert.doesNotMatch(before("Stop offering"), /disabled=""/);
	});

	it("points at no control that is not there for a superseded one", () => {
		const html = render({
			invite: { ...kickoffInvite, state: "superseded", sequence: 1 },
		});
		assert.doesNotMatch(html, /Open the newer invitation/);
		assert.doesNotMatch(html, /Answer the newer one/);
	});

	it("holds the answers while one is on its way", () => {
		const html = render({ busy: true });
		const accept = html.slice(0, html.indexOf("Add to calendar"));
		assert.match(accept.slice(accept.lastIndexOf("<button")), /disabled=""/);
	});

	it("draws no guest tally when the invitation named nobody", () => {
		const html = render({
			invite: {
				...kickoffInvite,
				proposed: { ...kickoffInvite.proposed, attendees: [] },
			},
		});
		assert.doesNotMatch(html, /guests/);
	});
});
