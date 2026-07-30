import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { FolderRow } from "./folder-row.js";

const meta: Meta<typeof FolderRow> = {
	title: "Mail/FolderRow",
	component: FolderRow,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof FolderRow>;

function List({ children }: { children: ReactNode }) {
	return (
		<div className="w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg">
			{children}
		</div>
	);
}

export const Closed: Story = {
	name: "Closed",
	render: () => (
		<List>
			<FolderRow
				label="Travel"
				depth={0}
				expanded={false}
				ariaLabel="Move to Travel"
				tabIndex={0}
			/>
		</List>
	),
};

export const Open: Story = {
	name: "Open, with its children indented under it",
	render: () => (
		<List>
			<FolderRow
				label="Travel"
				depth={0}
				expanded
				ariaLabel="Move to Travel"
				separated
			/>
			<FolderRow
				label="Hotels"
				depth={1}
				expanded={false}
				ariaLabel="Move to Hotels"
				separated
			/>
			<FolderRow
				label="Flights"
				depth={1}
				expanded={false}
				ariaLabel="Move to Flights"
			/>
		</List>
	),
};

export const Selected: Story = {
	name: "The destination",
	render: () => (
		<List>
			<FolderRow
				label="Hotels"
				depth={1}
				expanded={false}
				selected
				ariaLabel="Move to Hotels"
			/>
		</List>
	),
};

/** Where the messages live now: a marker, never a disabled control. */
export const Current: Story = {
	name: "The folder you are in",
	render: () => (
		<List>
			<FolderRow
				label="Inbox"
				depth={0}
				expanded={false}
				current
				currentTag="current"
				ariaLabel="Inbox (current folder)"
			/>
		</List>
	),
};

/** A branch on screen only to hold the match under it: it reads, it never operates. */
export const Context: Story = {
	name: "A branch held open by a match below it",
	render: () => (
		<List>
			<FolderRow
				label="Travel"
				depth={0}
				expanded
				context
				ariaLabel="Travel (containing folder)"
				separated
			/>
			<FolderRow
				label="Hotels"
				depth={1}
				expanded={false}
				ariaLabel="Move to Hotels"
			/>
		</List>
	),
};
