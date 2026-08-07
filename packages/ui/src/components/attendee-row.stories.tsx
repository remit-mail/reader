import type { Meta, StoryObj } from "@storybook/react-vite";
import { AttendeeList, RsvpBadge } from "./attendee-row.js";
import type { CalendarAttendee } from "./calendar-types.js";

/**
 * Who is coming, and whether they said so. The reply is words and a mark, never
 * a colour on its own.
 */
const meta: Meta = {
	title: "Calendar/Attendees",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

const attendees: CalendarAttendee[] = [
	{
		name: "Priya Natarajan",
		email: "priya@northwind.example",
		rsvp: "accepted",
		role: "organizer",
	},
	{
		name: "Marcus Webb",
		email: "marcus@northwind.example",
		rsvp: "accepted",
		role: "attendee",
	},
	{
		name: "Dana Okafor",
		email: "dana@northwind.example",
		rsvp: "tentative",
		role: "attendee",
	},
	{
		name: "Aisha Khan",
		email: "aisha@northwind.example",
		rsvp: "noReply",
		role: "attendee",
	},
	{
		name: "Sven Larsen",
		email: "sven@northwind.example",
		rsvp: "declined",
		role: "attendee",
	},
];

/** A full guest list, with the tally read off it rather than stated twice. */
export const List: Story = {
	render: () => (
		<div className="max-w-sm rounded-lg border border-line bg-surface p-3">
			<AttendeeList attendees={attendees} />
		</div>
	),
};

export const EveryReply: Story = {
	render: () => (
		<div className="flex gap-4">
			<RsvpBadge rsvp="accepted" />
			<RsvpBadge rsvp="tentative" />
			<RsvpBadge rsvp="declined" />
			<RsvpBadge rsvp="noReply" />
		</div>
	),
};
