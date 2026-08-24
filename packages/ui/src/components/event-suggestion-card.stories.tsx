import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { EventSuggestion, ZoneOptions } from "./calendar-types.js";
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
	senderAddress: "automated@airbnb.example",
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

const twoClocks: ZoneOptions = [
	{
		timeZone: "Europe/Lisbon",
		label: "16:00 in Lisbon",
		note: "17:00 on your own clock. The hour she keeps.",
	},
	{
		timeZone: "Europe/Amsterdam",
		label: "16:00 in Amsterdam",
		note: "15:00 where she is.",
	},
];

const call: EventSuggestion = {
	...base,
	id: "s3",
	title: "Kickoff call — Lisbon venue",
	allDay: false,
	location: "Meet link",
	threadSubject: "Kickoff call on Wednesday at 16:00",
	sender: "Rita Sousa",
	confidence: 0.66,
	ambiguity:
		"Rita writes from Lisbon and names 16:00 without a clock. Lisbon runs an hour behind Amsterdam.",
	timeZone: "",
	zoneCertainty: "ambiguous",
	zoneOptions: twoClocks,
};

function GatedCall({ picked }: { picked: string }) {
	const [zoneChoice, setZoneChoice] = useState(picked);
	const [carried, setCarried] = useState("");
	return (
		<div className="flex flex-col gap-2">
			<EventSuggestionCard
				suggestion={call}
				whenText="Wednesday 17 June · 16:00 – 17:00"
				zoneChoice={zoneChoice}
				onZoneChoice={setZoneChoice}
				onAdd={(timeZone) => setCarried(`Added on ${timeZone}`)}
				onReview={(timeZone) => setCarried(`Editor opened on ${timeZone}`)}
				onDismiss={() => {}}
				onOpenThread={() => {}}
			/>
			<p className="text-2xs text-fg-subtle">
				{carried === "" ? "Nothing has left the card yet." : carried}
			</p>
		</div>
	);
}

/**
 * The mail printed an hour and never said whose clock it is on. Both ways out
 * of the card are dimmed and stay dimmed until one is picked — an hour guessed
 * wrong is a call missed, and an editor opened on that hour hides the guess
 * behind a field the reader is invited to trust.
 */
export const ZoneWeCannotDetermine: Story = {
	name: "The zone we cannot determine",
	render: () => <GatedCall picked="" />,
};

/**
 * Answered. Both buttons are live, and each carries the clock that was named —
 * Add books it, Change first opens on it.
 */
export const ZonePicked: Story = {
	name: "The clock is picked",
	render: () => <GatedCall picked="Europe/Lisbon" />,
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
