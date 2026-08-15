import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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

/**
 * The same list where the surface has something to say about the person behind
 * a row. A row is then a disclosure: it opens under the guest, the same
 * activation closes it, and what opens is the caller's — the kit places it and
 * knows nothing else about it.
 */
export const WithContext: Story = {
	render: () => {
		const [active, setActive] = useState("");
		return (
			<div className="max-w-sm rounded-lg border border-line bg-surface p-3">
				<AttendeeList
					attendees={attendees}
					activeEmail={active}
					onActivate={setActive}
					renderContext={(attendee) => (
						<p className="w-64 rounded-lg border border-line bg-surface-raised p-3 text-xs text-fg-muted shadow-xl shadow-black/25">
							{`Everything ${attendee.name} has written lately would go here.`}
						</p>
					)}
				/>
			</div>
		);
	},
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
