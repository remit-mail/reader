import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { FolderManageActions } from "./folder-manage-actions.js";
import { FolderRow } from "./folder-row.js";

const meta: Meta<typeof FolderManageActions> = {
	title: "Mail/FolderManageActions",
	component: FolderManageActions,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof FolderManageActions>;

function List({ children }: { children: ReactNode }) {
	return (
		<div className="w-[360px] overflow-hidden rounded-lg border border-line bg-surface font-sans text-fg">
			{children}
		</div>
	);
}

export const OnARow: Story = {
	name: "Beside the folder it acts on",
	render: () => (
		<List>
			<FolderRow
				label="Travel"
				depth={0}
				expanded={false}
				ariaLabel="Travel"
				separated
				actions={
					<FolderManageActions
						label="Travel"
						onRename={() => {}}
						onDelete={() => {}}
					/>
				}
			/>
			<FolderRow
				label="Hotels"
				depth={1}
				expanded={false}
				ariaLabel="Hotels"
				actions={
					<FolderManageActions
						label="Hotels"
						onRename={() => {}}
						onDelete={() => {}}
					/>
				}
			/>
		</List>
	),
};

/** A folder the account depends on keeps rename and states why it stays. */
export const Blocked: Story = {
	name: "A folder that can't be deleted",
	render: () => (
		<List>
			<FolderRow
				label="Inbox"
				depth={0}
				expanded={false}
				ariaLabel="Inbox"
				separated
				actions={
					<FolderManageActions
						label="Inbox"
						deleteBlockedReason="The inbox can't be deleted."
						onRename={() => {}}
						onDelete={() => {}}
					/>
				}
			/>
			<FolderRow
				label="Trash"
				depth={0}
				expanded={false}
				ariaLabel="Trash"
				actions={
					<FolderManageActions
						label="Trash"
						deleteBlockedReason="This folder is your Trash folder. Reassign that role before deleting it."
						onRename={() => {}}
						onDelete={() => {}}
					/>
				}
			/>
		</List>
	),
};
