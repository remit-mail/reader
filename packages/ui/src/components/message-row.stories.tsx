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
			<ComfortableRow thread={unread} />
			<ComfortableRow thread={read} />
			<ComfortableRow thread={starred} />
			<ComfortableRow thread={suspicious} />
		</List>
	),
};
