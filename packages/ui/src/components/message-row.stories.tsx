import type { Meta, StoryObj } from "@storybook/react";
import type { ThreadRowData } from "./app-shell-types.js";
import { ComfortableRow, CompactRow } from "./message-row.js";

const read: ThreadRowData = {
	id: "r-read",
	accountId: "a1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Re: Q3 planning notes",
	snippet: "Sounds good — I pushed the deck to the shared drive.",
	timeLabel: "9:42",
	isRead: true,
};

const unread: ThreadRowData = {
	id: "r-unread",
	accountId: "a1",
	fromName: "Priya Nair",
	fromEmail: "priya@example.com",
	subject: "Design review tomorrow",
	snippet: "Can we move it to 2pm? I have a conflict in the morning.",
	timeLabel: "8:15",
	isRead: false,
	messageCount: 3,
};

const starred: ThreadRowData = {
	id: "r-starred",
	accountId: "a1",
	fromName: "Sam Okafor",
	fromEmail: "sam@example.com",
	subject: "Contract signed",
	snippet: "Attaching the countersigned PDF for your records.",
	timeLabel: "Mon",
	isRead: true,
	starred: true,
};

const suspicious: ThreadRowData = {
	id: "r-suspicious",
	accountId: "a1",
	fromName: "Account Security",
	fromEmail: "no-reply@secure-update.example",
	subject: "Verify your account immediately",
	snippet: "Your account will be suspended unless you confirm now.",
	timeLabel: "Tue",
	isRead: false,
	suspicious: true,
};

const withAttachment: ThreadRowData = {
	id: "r-attachment",
	accountId: "a1",
	fromName: "Dana Lopez",
	fromEmail: "dana@example.com",
	subject: "Invoice for May",
	snippet: "Please find the attached invoice, due end of month.",
	timeLabel: "Wed",
	isRead: true,
	hasAttachment: true,
};

const withCategory: ThreadRowData = {
	id: "r-category",
	accountId: "a1",
	fromName: "The Weekly Brief",
	fromEmail: "hello@weekly.example",
	subject: "This week in product",
	snippet: "Five stories you might have missed this week.",
	timeLabel: "Thu",
	isRead: false,
	category: "newsletter",
};

const noLabel: ThreadRowData = {
	id: "r-no-label",
	accountId: "a1",
	fromName: "Jordan Lee",
	fromEmail: "jordan@example.com",
	subject: "Lunch on Friday?",
	snippet: "Thinking the usual place, around noon.",
	timeLabel: "10:03",
	isRead: true,
};

const oneLabel: ThreadRowData = {
	id: "r-one-label",
	accountId: "a1",
	fromName: "Stripe",
	fromEmail: "receipts@stripe.com",
	subject: "Your receipt from Acme Co",
	snippet: "Payment of $42.00 was successful.",
	timeLabel: "9:10",
	isRead: true,
	labels: [{ labelId: "l1", name: "Receipts", color: "Blue" }],
};

const twoLabels: ThreadRowData = {
	id: "r-two-labels",
	accountId: "a1",
	fromName: "United Airlines",
	fromEmail: "noreply@united.com",
	subject: "Your itinerary for SFO → JFK",
	snippet: "Check-in opens 24 hours before departure.",
	timeLabel: "Yesterday",
	isRead: false,
	labels: [
		{ labelId: "l1", name: "Receipts", color: "Blue" },
		{ labelId: "l2", name: "Travel", color: "Green" },
	],
};

const severalLabels: ThreadRowData = {
	id: "r-several-labels",
	accountId: "a1",
	fromName: "Finance Team",
	fromEmail: "finance@example.com",
	subject: "Q3 budget review — action needed",
	snippet: "Please review the attached numbers before Thursday.",
	timeLabel: "Mon",
	isRead: false,
	labels: [
		{ labelId: "l1", name: "Receipts", color: "Blue" },
		{ labelId: "l2", name: "Travel", color: "Green" },
		{ labelId: "l3", name: "Urgent", color: "Red" },
		{ labelId: "l4", name: "Work", color: "Purple" },
	],
};

const longLabelName: ThreadRowData = {
	id: "r-long-label",
	accountId: "a1",
	fromName: "Compliance",
	fromEmail: "compliance@example.com",
	subject: "Filing due end of quarter",
	snippet: "One outstanding item on the checklist.",
	timeLabel: "Tue",
	isRead: true,
	labels: [
		{
			labelId: "l5",
			name: "Quarterly compliance filings that need a second look",
			color: "Purple",
		},
	],
};

const movePending: ThreadRowData = {
	id: "r-move-pending",
	accountId: "a1",
	fromName: "Nadia Haddad",
	fromEmail: "nadia@example.com",
	subject: "Warehouse handover checklist",
	snippet: "Moved to Archive a moment ago; the server has not confirmed it.",
	timeLabel: "11:20",
	isRead: true,
	settlement: "in_flight",
};

const moveAbandoned: ThreadRowData = {
	id: "r-move-abandoned",
	accountId: "a1",
	fromName: "Tomas Berg",
	fromEmail: "tomas@example.com",
	subject: "Signed lease, final version",
	snippet: "Deleted here; the mail server refused and Remit stopped retrying.",
	timeLabel: "Mon",
	isRead: false,
	settlement: "abandoned",
};

const abandonedWithLabels: ThreadRowData = {
	...moveAbandoned,
	id: "r-abandoned-labels",
	category: "newsletter",
	labels: [{ labelId: "l1", name: "Receipts", color: "Blue" }],
};

const unsettled = [movePending, moveAbandoned, abandonedWithLabels, read];

const labeled = [noLabel, oneLabel, twoLabels, severalLabels, longLabelName];

const all = [read, unread, starred, suspicious, withAttachment, withCategory];

const meta: Meta = {
	title: "Primitives/MessageRow",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

const List = ({ children }: { children: React.ReactNode }) => (
	<div className="w-md divide-y divide-line rounded-md border border-line">
		{children}
	</div>
);

export const Comfortable: Story = {
	render: () => (
		<List>
			{all.map((thread) => (
				<ComfortableRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

export const Compact: Story = {
	render: () => (
		<List>
			{all.map((thread) => (
				<CompactRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

export const States: Story = {
	render: () => (
		<List>
			<ComfortableRow thread={unread} active />
			<ComfortableRow thread={read} focused />
			<ComfortableRow thread={starred} />
			<ComfortableRow thread={suspicious} />
		</List>
	),
};

/**
 * Selectable rows. The checkbox layers over the avatar: hidden until hover
 * while unchecked, pinned visible once checked or while the list is in
 * multi-select mode. A row rendered without `selection` — the brief and
 * Flagged before they gained selection — shows the avatar alone.
 */
export const Selectable: Story = {
	render: () => (
		<List>
			<ComfortableRow
				thread={unread}
				selection={{ checked: true, onToggle: () => undefined }}
			/>
			<ComfortableRow
				thread={read}
				selection={{ checked: false, onToggle: () => undefined }}
			/>
			<ComfortableRow
				thread={starred}
				selection={{
					checked: false,
					alwaysVisible: true,
					onToggle: () => undefined,
				}}
			/>
			<ComfortableRow thread={withCategory} />
		</List>
	),
};

/**
 * Labels (issue #26) alongside the existing read/unread, attachment and
 * category affordances — no label, one, two, several, and a long name that
 * truncates rather than growing the row. Comfortable density renders the
 * chips; compact does not (see `CompactLabels` below).
 */
export const ComfortableLabels: Story = {
	render: () => (
		<List>
			{labeled.map((thread) => (
				<ComfortableRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

/** The same labeled threads on the dark theme. */
export const ComfortableLabelsDark: Story = {
	name: "Comfortable Labels (dark)",
	parameters: { theme: "dark" },
	render: () => (
		<List>
			{labeled.map((thread) => (
				<ComfortableRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

/**
 * The same labeled threads in compact density. `CompactRowBody` carries no
 * label rendering today — this documents that as the approved current
 * behavior, not an oversight in the story.
 */
export const CompactLabels: Story = {
	render: () => (
		<List>
			{labeled.map((thread) => (
				<CompactRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

/** Compact density, dark theme. */
export const CompactLabelsDark: Story = {
	name: "Compact Labels (dark)",
	parameters: { theme: "dark" },
	render: () => (
		<List>
			{labeled.map((thread) => (
				<CompactRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

/**
 * A row whose last IMAP mutation has not settled (issue #1002). `in_flight`
 * is the ordinary optimistic case — the move or delete is still being pushed
 * and clears itself. `abandoned` is the one the user has to know about: the
 * push gave up, so the message is not where this list says it is. The chip
 * names the state; the open message carries the full statement and the way
 * out (`MessageSettlementNotice`).
 */
export const Unsettled: Story = {
	render: () => (
		<List>
			{unsettled.map((thread) => (
				<ComfortableRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

/** The same rows on the dark theme. */
export const UnsettledDark: Story = {
	name: "Unsettled (dark)",
	parameters: { theme: "dark" },
	render: () => (
		<List>
			{unsettled.map((thread) => (
				<ComfortableRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};

/** Compact density carries the same chip. */
export const UnsettledCompact: Story = {
	name: "Unsettled (compact)",
	render: () => (
		<List>
			{unsettled.map((thread) => (
				<CompactRow key={thread.id} thread={thread} />
			))}
		</List>
	),
};
