import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { EventSuggestion } from "./calendar-types.js";
import { EventSuggestionCard } from "./event-suggestion-card.js";

/**
 * What the reader found in a mail, waiting for a person. It sits on a dashed
 * card off the grid: a suggestion is never a provisional event that someone has
 * to notice and take back off the calendar.
 */
const meta: Meta<typeof EventSuggestionCard> = {
	title: "Calendar/Suggestion card",
	component: EventSuggestionCard,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="max-w-sm">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof EventSuggestionCard>;

const base: EventSuggestion = {
	id: "s1",
	title: "Stay in Lisbon",
	start: "2026-06-19",
	end: "2026-06-23",
	allDay: true,
	location: "Alfama, Lisbon",
	threadId: "thr_airbnb",
	threadSubject: "Your reservation in Lisbon is confirmed",
	sender: "Airbnb",
	confidence: 0.94,
	ambiguity: "",
	suggestedCalendarId: "c5",
	timeZone: "Europe/Lisbon",
	zoneCertainty: "explicit",
};

const handlers = {
	onAdd: () => {},
	onReview: () => {},
	onDismiss: () => {},
	onOpenThread: () => {},
};

/** A booking mail that gave every field it needed to. */
export const ReadCleanly: Story = {
	render: () => (
		<EventSuggestionCard
			suggestion={base}
			whenText="Friday 19 June – Monday 22 June"
			{...handlers}
		/>
	),
};

/** What it could not settle is named, not smoothed over. */
export const WithAmbiguity: Story = {
	render: () => (
		<EventSuggestionCard
			suggestion={{
				...base,
				id: "s2",
				title: "Analytics pilot — first call",
				allDay: false,
				location: "",
				threadSubject: "Following up: analytics pilot proposal",
				sender: "Erik Wahlberg",
				confidence: 0.38,
				ambiguity:
					'Asked for "some time Tuesday" and named no hour. Two Tuesdays fit.',
			}}
			whenText="Tuesday 16 June · 09:00 – 10:00"
			{...handlers}
		/>
	),
};

const twoClocks = [
	{
		timeZone: "Europe/Lisbon",
		label: "20:25 in Lisbon",
		note: "21:25 on your own clock. What an airline usually means.",
	},
	{
		timeZone: "Europe/Amsterdam",
		label: "20:25 in Amsterdam",
		note: "19:25 where the plane lands.",
	},
];

const flight: EventSuggestion = {
	...base,
	id: "s3",
	title: "KL1693 Amsterdam → Lisbon",
	allDay: false,
	location: "Schiphol, gate D-pier",
	threadSubject: "Your booking is confirmed — KL1693 Amsterdam to Lisbon",
	sender: "KLM",
	confidence: 0.88,
	ambiguity:
		"The confirmation prints 20:25 for the arrival and never says whose clock.",
	timeZone: "",
	zoneCertainty: "ambiguous",
	zoneOptions: twoClocks,
};

function GatedFlight({ picked }: { picked: string }) {
	const [zoneChoice, setZoneChoice] = useState(picked);
	return (
		<EventSuggestionCard
			suggestion={flight}
			whenText="Friday 19 June · 18:40 – 20:25"
			zoneChoice={zoneChoice}
			onZoneChoice={setZoneChoice}
			{...handlers}
		/>
	);
}

/**
 * The mail printed an hour and never said whose clock it is on. Add is dimmed
 * and stays dimmed until one is picked — an hour guessed wrong is a flight
 * missed, and the card would rather ask than annotate.
 */
export const ZoneWeCannotDetermine: Story = {
	name: "The zone we cannot determine",
	render: () => <GatedFlight picked="" />,
};

/** Answered. Add is live, and what it books is the clock that was named. */
export const ZonePicked: Story = {
	name: "The clock is picked",
	render: () => <GatedFlight picked="Europe/Lisbon" />,
};

/** The same card sized for a phone sheet. */
export const Touch: Story = {
	render: () => (
		<EventSuggestionCard
			suggestion={base}
			whenText="Friday 19 June – Monday 22 June"
			touch
			{...handlers}
		/>
	),
};
