import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { FolderRow } from "./folder-row.js";
import { NewFolderAction } from "./new-folder-action.js";

const meta: Meta<typeof NewFolderAction> = {
	title: "Mail/NewFolderAction",
	component: NewFolderAction,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof NewFolderAction>;

function List({ children }: { children: ReactNode }) {
	return (
		<div className="w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg">
			{children}
		</div>
	);
}

/** Pinned above a list, where it is the loudest thing a folder tree offers. */
export const Prominent: Story = {
	name: "Prominent (pinned above the list)",
	render: () => (
		<List>
			<NewFolderAction
				label="New folder"
				ariaLabel="New folder"
				onOpen={() => undefined}
			/>
		</List>
	),
};

/** The last thing inside an opened folder, subordinate to the folder it sits in. */
export const Quiet: Story = {
	name: "Quiet (inside an opened folder)",
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
			<NewFolderAction
				label="New folder"
				ariaLabel="New folder inside Travel"
				depth={1}
				prominence="quiet"
				onOpen={() => undefined}
			/>
		</List>
	),
};

export const BothTreatments: Story = {
	name: "Both treatments at once",
	render: () => (
		<List>
			<NewFolderAction
				label="New folder"
				ariaLabel="New folder"
				onOpen={() => undefined}
			/>
			<FolderRow
				label="Finance"
				depth={0}
				expanded
				ariaLabel="Move to Finance"
				separated
			/>
			<NewFolderAction
				label="New folder"
				ariaLabel="New folder inside Finance"
				depth={1}
				prominence="quiet"
				onOpen={() => undefined}
			/>
		</List>
	),
};
