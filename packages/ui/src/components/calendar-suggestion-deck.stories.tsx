import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CalendarSuggestionDeck } from "./calendar-suggestion-deck.js";
import type { EventSuggestion } from "./calendar-types.js";
import {
	EventSuggestionCard,
	settleZone,
	ZONE_UNSETTLED_REASON,
} from "./event-suggestion-card.js";

/**
 * Readings one at a time. The swipe is the fast path over the buttons that are
 * always there under it, so a gesture is never the only way to answer — and it
 * is refused on the same terms the buttons are, because a swipe that books a
 * time nobody placed on a clock is the mistake, not the shortcut.
 */
const meta: Meta<typeof CalendarSuggestionDeck> = {
	title: "Calendar/Suggestion deck",
	component: CalendarSuggestionDeck,
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

type Story = StoryObj<typeof CalendarSuggestionDeck>;

const flight: EventSuggestion = {
	id: "sug_flight",
	title: "KL1693 Amsterdam → Lisbon",
	start: "2026-06-19T18:40:00+02:00",
	end: "2026-06-19T20:25:00+02:00",
	allDay: false,
	location: "Schiphol, gate D-pier",
	threadId: "thr_klm",
	threadSubject: "Your booking is confirmed — KL1693 Amsterdam to Lisbon",
	sender: "KLM",
	senderAddress: "noreply@klm.example",
	confidence: 0.88,
	ambiguity:
		"The confirmation prints 20:25 for the arrival and never says whose clock.",
	suggestedCalendarId: "cal_travel",
	timeZone: "",
	zoneCertainty: "ambiguous",
	zoneOptions: [
		{
			timeZone: "Europe/Lisbon",
			label: "20:25 in Lisbon",
			note: "21:25 on your own clock.",
		},
		{
			timeZone: "Europe/Amsterdam",
			label: "20:25 in Amsterdam",
			note: "19:25 where the plane lands.",
		},
	],
};

const stated: EventSuggestion = {
	...flight,
	id: "sug_dinner",
	title: "Dinner with Rita",
	ambiguity: "",
	timeZone: "Europe/Amsterdam",
	zoneCertainty: "explicit",
	zoneOptions: undefined,
};

const inertCard = {
	onDismiss: () => undefined,
	onOpenThread: () => undefined,
};

function Deck({ queue }: { queue: EventSuggestion[] }) {
	const [pending, setPending] = useState(queue);
	const [zone, setZone] = useState("");
	const [last, setLast] = useState("");
	const top = pending[0];
	const settlement = top === undefined ? undefined : settleZone(top, zone);

	const drop = () => {
		setPending((prev) => prev.slice(1));
		setZone("");
	};

	return (
		<div className="flex flex-col gap-2">
			<CalendarSuggestionDeck
				hasCard={top !== undefined}
				remaining={pending.length}
				blocked={settlement !== undefined && !settlement.settled}
				blockedReason={ZONE_UNSETTLED_REASON}
				confirmLabel="Add"
				onConfirm={() => {
					if (top && settlement?.settled) {
						setLast(
							`added ${top.title} on ${settlement.timeZone || "its own clock"}`,
						);
						drop();
					}
				}}
				onReject={() => {
					if (top) setLast(`dropped ${top.title}`);
					drop();
				}}
			>
				{top && (
					<EventSuggestionCard
						{...inertCard}
						suggestion={top}
						whenText="Friday 19 June · 18:40 – 20:25"
						zoneChoice={zone}
						onZoneChoice={setZone}
						onAdd={() => undefined}
						onReview={() => undefined}
					/>
				)}
			</CalendarSuggestionDeck>
			{last !== "" && (
				<p className="text-2xs text-fg-subtle">Prototype: {last}</p>
			)}
		</div>
	);
}

/** The clock is unstated, so the swipe says why it will not commit. */
export const HeldOnAnUnsettledClock: Story = {
	render: () => <Deck queue={[flight]} />,
};

/** The mail already said which clock, so the deck is live from the start. */
export const ReadyToConfirm: Story = {
	render: () => <Deck queue={[stated]} />,
};

/** A queue, counted, so the reader knows what answering buys them. */
export const AQueueOfThree: Story = {
	render: () => (
		<Deck
			queue={[
				stated,
				{ ...stated, id: "sug_haircut", title: "Haircut" },
				{ ...stated, id: "sug_mot", title: "Car inspection" },
			]}
		/>
	),
};

/** Nothing left. The empty deck says so in the reader's own terms. */
export const NothingWaiting: Story = {
	args: {
		hasCard: false,
		remaining: 0,
		blocked: false,
		blockedReason: "",
		onConfirm: () => undefined,
		onReject: () => undefined,
		children: null,
	},
};
