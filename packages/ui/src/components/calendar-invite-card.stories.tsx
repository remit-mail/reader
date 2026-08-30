import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarInviteCard } from "./calendar-invite-card.js";
import type { CalendarInvite, RsvpState } from "./calendar-types.js";
import {
	dentistClash,
	kickoffInvite,
} from "./intelligence-calendar-fixtures.js";

/**
 * The invitation as the thing it is, rather than an attachment nobody opens.
 * What saying yes runs into is stated above the button, and the card says the
 * organiser hears nothing — this plan sends no reply at all.
 */
const meta: Meta<typeof CalendarInviteCard> = {
	title: "Calendar/Invite card",
	component: CalendarInviteCard,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="max-w-md">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof CalendarInviteCard>;

const inert = {
	onAdd: () => undefined,
	onTentative: () => undefined,
	onDecline: () => undefined,
	onReopen: () => undefined,
	onOfferOtherTimes: () => undefined,
};

const base = {
	invite: kickoffInvite,
	whenText: "Thursday 11 June, 14:00 – 15:00",
	calendarName: "Work",
	color: "cal-2",
	clashes: dentistClash,
	rsvp: "noReply",
	...inert,
} as const;

const superseded: CalendarInvite = {
	...kickoffInvite,
	state: "superseded",
	sequence: 1,
	evidence: "invite.ics · METHOD:REQUEST · SEQUENCE:1",
};

const cancelled: CalendarInvite = {
	...kickoffInvite,
	state: "cancelled",
	sequence: 2,
	evidence: "cancel.ics · METHOD:CANCEL · STATUS:CANCELLED",
};

/** The clash stated before the answer, which is the whole point of the card. */
export const WithAClash: Story = {
	args: base,
};

/** The same invitation on an empty afternoon. Silence would read as unchecked. */
export const NothingBooked: Story = {
	args: { ...base, clashes: [] },
};

/** Answered. The card keeps saying the organiser was never told. */
export const AlreadyOnTheCalendar: Story = {
	args: { ...base, rsvp: "accepted", clashes: [] },
};

/** Declined, with the way back to offering other times still open. */
export const Declined: Story = {
	args: { ...base, rsvp: "declined", clashes: [] },
};

/** A later message carried a higher SEQUENCE, so this one is not the question. */
export const OvertakenByANewerRevision: Story = {
	args: { ...base, invite: superseded, onOpenNewer: () => undefined },
};

/** Cancelled, and still on the calendar until the reader takes it off. */
export const Cancelled: Story = {
	args: {
		...base,
		invite: cancelled,
		rsvp: "accepted",
		onRemove: () => undefined,
	},
};

/** A host with its own guest surface passes it in rather than growing a second. */
export const WithTheHostsGuestList: Story = {
	args: {
		...base,
		guests: (
			<ul className="flex flex-col gap-0.5 text-xs text-fg-muted">
				<li>Priya Natarajan — organiser</li>
				<li>Marcus Webb — coming</li>
				<li>Dana Okafor — no reply</li>
			</ul>
		),
	},
};

/** Thumb-sized targets, wrapped so three answers fit a phone. */
export const Touch: Story = {
	args: { ...base, touch: true },
};

/** The card answering for real, so the review is a click-through. */
export const Answering: Story = {
	render: () => {
		const [rsvp, setRsvp] = useState<RsvpState>("noReply");
		return (
			<CalendarInviteCard
				{...base}
				rsvp={rsvp}
				onAdd={() => setRsvp("accepted")}
				onTentative={() => setRsvp("tentative")}
				onDecline={() => setRsvp("declined")}
				onReopen={() => setRsvp("noReply")}
			/>
		);
	},
};
