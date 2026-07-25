import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	type MoveMailboxOption,
	MoveMailboxPicker,
} from "./move-mailbox-picker.js";

const mailboxes: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox", isCurrent: true },
	{ id: "archive", label: "Archive" },
	{ id: "trash", label: "Trash" },
	{ id: "spam", label: "Spam" },
	{ id: "receipts", label: "Receipts", searchValue: "finance/receipts" },
	{ id: "travel", label: "Travel", searchValue: "finance/travel" },
	{ id: "newsletters", label: "Newsletters" },
];

const manyMailboxes: MoveMailboxOption[] = [
	{ id: "inbox", label: "Inbox", isCurrent: true },
	...Array.from({ length: 24 }, (_, i) => ({
		id: `folder-${i}`,
		label: `Project ${String(i + 1).padStart(2, "0")}`,
	})),
];

const meta: Meta<typeof MoveMailboxPicker> = {
	title: "Mail/MoveMailboxPicker",
	component: MoveMailboxPicker,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-72 max-h-96 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof MoveMailboxPicker>;

const Picker = ({ options }: { options: MoveMailboxOption[] }) => {
	const [moved, setMoved] = useState<string | null>(null);
	return (
		<div className="flex flex-col">
			<MoveMailboxPicker mailboxes={options} onSelect={setMoved} />
			{moved && (
				<p className="border-t border-line px-3 py-2 text-xs text-fg-muted">
					Moved to {moved}
				</p>
			)}
		</div>
	);
};

export const Default: Story = {
	name: "Default (current folder marked)",
	render: () => <Picker options={mailboxes} />,
};

export const ManyMailboxes: Story = {
	name: "Many mailboxes (scrolls)",
	render: () => <Picker options={manyMailboxes} />,
};

export const Empty: Story = {
	name: "Empty list",
	render: () => <Picker options={[]} />,
};

export const Autofocus: Story = {
	name: "Autofocus search (mobile sheet)",
	render: () => (
		<MoveMailboxPicker mailboxes={mailboxes} onSelect={() => {}} autoFocus />
	),
};

let createdSeq = 0;
const mockCreateFolder = (name: string): Promise<MoveMailboxOption> =>
	new Promise((resolve) => {
		createdSeq += 1;
		setTimeout(
			() => resolve({ id: `created-${createdSeq}`, label: name }),
			400,
		);
	});

const CreatePicker = () => {
	const [moved, setMoved] = useState<string | null>(null);
	return (
		<div className="flex flex-col">
			<MoveMailboxPicker
				mailboxes={mailboxes}
				onSelect={setMoved}
				onCreateFolder={mockCreateFolder}
			/>
			{moved && (
				<p className="border-t border-line px-3 py-2 text-xs text-fg-muted">
					Moved to {moved}
				</p>
			)}
		</div>
	);
};

/**
 * With `onCreateFolder` wired, a search that names no existing folder offers a
 * create-and-move row at the bottom. Type e.g. "Taxes", then pick the create
 * row — the folder is created and the message moved into it in one step.
 */
export const CreateAndMove: Story = {
	name: "Create folder from search",
	render: () => <CreatePicker />,
};
