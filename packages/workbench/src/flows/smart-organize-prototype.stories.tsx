import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	INBOX_MESSAGES,
	type MockMessage,
	PrototypeMoveSlot,
	RealisticInbox,
	SelectionSheet,
	SmartOrganizeFlow,
} from "./smart-organize-prototype.js";

const meta: Meta = {
	title: "Flows/Smart Organize",
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[760px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj;

const BOOKINGS: MockMessage[] = [
	{
		sender: "Airbnb",
		subject: "Your reservation is confirmed – Lisbon, Jul 12–16",
	},
	{ sender: "Booking.com", subject: "Booking confirmation: Hotel Bairro Alto" },
	{ sender: "Expedia", subject: "Itinerary for your upcoming trip" },
];

/**
 * The isolated in-sheet organize panels — `Organize`, `From Search`,
 * `Always Rule`, `SomethingElse` — render the real web-client components and
 * live in `packages/web-client/src/components/mail/organize/`, under this same
 * `Flows/Smart Organize` group. The interactive prototype below is the design
 * reference; the app's own stories are the source of truth for what ships.
 */

/**
 * PRIMARY STORY — fully interactive hi-fi Remit inbox.
 *
 * Tap an avatar to select a message; tap again to deselect. Once 2+ rows are
 * selected, a peeking teaser row (~56 px) rises from the bottom showing the
 * count and a "Swipe up for actions" hint. Drag or tap the teaser to expand
 * to a 1/3-screen sheet with:
 *
 *  - Quick actions row: Delete / Move / Junk
 *  - "Select similar messages" (primary) — briefly shows a selecting flash,
 *    adds all travel/booking rows, then opens the Organize sheet.
 *  - "Something else" (secondary) — opens the suggestions+plain-text sheet.
 *
 * The expanded sheet drags back down to the teaser (selection stays). All
 * deeper sheets (Organize, SomethingElse) drag down or tap-scrim to dismiss.
 */
export const Inbox: Story = {
	render: () => <RealisticInbox />,
};

/**
 * Walkthrough — the full flow pre-seeded with 3 booking messages. The peeking
 * teaser is immediately visible; pull up or tap to see the full sheet.
 */
export const Walkthrough: Story = {
	render: () => (
		<SmartOrganizeFlow selectedMessages={BOOKINGS} similarCount={47} />
	),
};

/**
 * SelectionSheet — the peeking selection sheet in isolation, starting
 * collapsed (teaser row). Drag or tap to expand to the 1/3-height sheet;
 * drag or tap the grabber to collapse back to the teaser.
 *
 * Shows both snap states without needing to interact with the full inbox.
 */
export const SelectionSheetStory: Story = {
	name: "SelectionSheet",
	render: () => (
		<div className="relative h-full overflow-hidden bg-surface">
			{/* inbox backdrop */}
			<div className="divide-y divide-line opacity-50">
				{INBOX_MESSAGES.slice(0, 10).map((msg) => (
					<div
						key={msg.id}
						className="flex items-start gap-3 px-row-inset py-2.5"
					>
						<div className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken" />
						<div className="min-w-0 flex-1 space-y-1">
							<div className="h-2.5 w-1/3 rounded bg-surface-sunken" />
							<div className="h-2 w-2/3 rounded bg-surface-sunken" />
						</div>
					</div>
				))}
			</div>
			<SelectionSheet
				count={3}
				onCancel={() => {}}
				onDelete={() => {}}
				onJunk={() => {}}
				onMarkRead={() => {}}
				onSelectSimilar={() => {}}
				onSomethingElse={() => {}}
				moveSlot={<PrototypeMoveSlot />}
			/>
		</div>
	),
};

/**
 * SelectionSheet (expanded) — same as SelectionSheet but pre-opened to the
 * expanded 1/3-screen state, so both snap states are easy to compare.
 */
export const SelectionSheetExpanded: Story = {
	name: "SelectionSheet (expanded)",
	render: () => (
		<div className="relative h-full overflow-hidden bg-surface">
			{/* inbox backdrop */}
			<div className="divide-y divide-line opacity-50">
				{INBOX_MESSAGES.slice(0, 10).map((msg) => (
					<div
						key={msg.id}
						className="flex items-start gap-3 px-row-inset py-2.5"
					>
						<div className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken" />
						<div className="min-w-0 flex-1 space-y-1">
							<div className="h-2.5 w-1/3 rounded bg-surface-sunken" />
							<div className="h-2 w-2/3 rounded bg-surface-sunken" />
						</div>
					</div>
				))}
			</div>
			<SelectionSheet
				count={3}
				onCancel={() => {}}
				onDelete={() => {}}
				onJunk={() => {}}
				onMarkRead={() => {}}
				onSelectSimilar={() => {}}
				onSomethingElse={() => {}}
				moveSlot={<PrototypeMoveSlot />}
				startExpanded
			/>
		</div>
	),
};
