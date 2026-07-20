import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { ThreadRowData } from "./app-shell-types.js";
import { SwipeableRow, type SwipePeek } from "./swipeable-row.js";

const sampleThread: ThreadRowData = {
	id: "thread-1",
	accountId: "account-1",
	fromName: "Alex Rivera",
	fromEmail: "alex@example.com",
	subject: "Q3 planning notes",
	snippet: "Here are the notes from our planning session earlier today.",
	timeLabel: "9:42",
	isRead: false,
};

const baseArgs = {
	thread: sampleThread,
	selectionMode: false,
	checked: false,
	active: false,
	onPeek: () => undefined,
	onToggleCheck: () => undefined,
	onLongPress: () => undefined,
	onOpen: () => undefined,
	onAct: () => undefined,
};

function PhoneFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="max-w-md overflow-hidden rounded-lg border border-line">
			{children}
		</div>
	);
}

const meta: Meta<typeof SwipeableRow> = {
	title: "Primitives/SwipeableRow",
	component: SwipeableRow,
	parameters: { layout: "padded" },
	args: baseArgs,
	render: (args) => (
		<PhoneFrame>
			<SwipeableRow {...args} />
		</PhoneFrame>
	),
};
export default meta;

type Story = StoryObj<typeof SwipeableRow>;

export const Rest: Story = { args: { peek: "none" } };

export const PeekedLeading: Story = { args: { peek: "leading" } };

export const PeekedTrailing: Story = { args: { peek: "trailing" } };

/**
 * In selection mode the leading avatar is REPLACED by a checkbox affordance
 * — unchecked below, checked in the next story. `baseArgs` never flips
 * `selectionMode`/`checked`, so this row-level toggle had zero coverage.
 */
export const SelectionUnchecked: Story = {
	args: { peek: "none", selectionMode: true, checked: false },
};

/** Selection mode, row checked: the circle fills accent and shows a tick. */
export const SelectionChecked: Story = {
	args: { peek: "none", selectionMode: true, checked: true },
};

/**
 * The open affordance is rendered as a real `<a href>` via `linkComponent`,
 * so deep-link, middle-click and open-in-new-tab work. Consumers pass their
 * router's Link; here a plain anchor stands in. Inspect the DOM: the row is an
 * anchor, not a button.
 */
export const AsAnchor: Story = {
	name: "As anchor (linkComponent)",
	args: {
		peek: "none",
		linkComponent: ({ onOpenClick, children, ...rowProps }) => (
			<a
				{...rowProps}
				href="/mail/inbox?selectedMessageId=thread-1"
				onClick={(e) => {
					e.preventDefault();
					onOpenClick(e);
				}}
			>
				{children}
			</a>
		),
	},
};

export const Acting: Story = {
	name: "Acting (interactive)",
	render: () => {
		const [thread, setThread] = useState<ThreadRowData>(sampleThread);
		const [peek, setPeek] = useState<SwipePeek>("trailing");
		const [deleted, setDeleted] = useState(false);
		if (deleted) {
			return (
				<PhoneFrame>
					<div className="flex h-16 items-center justify-center text-sm text-fg-muted">
						Message deleted
					</div>
				</PhoneFrame>
			);
		}
		return (
			<PhoneFrame>
				<SwipeableRow
					{...baseArgs}
					thread={thread}
					peek={peek}
					onPeek={setPeek}
					onAct={(side) => {
						if (side === "trailing") {
							setDeleted(true);
							return;
						}
						setThread((prev) => ({ ...prev, isRead: !prev.isRead }));
						setPeek("none");
					}}
				/>
			</PhoneFrame>
		);
	},
};
