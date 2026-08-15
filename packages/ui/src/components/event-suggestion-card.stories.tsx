import type { Meta, StoryObj } from "@storybook/react-vite";
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
