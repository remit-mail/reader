import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FolderRenameDialog } from "./folder-rename-dialog.js";

const meta: Meta<typeof FolderRenameDialog> = {
	title: "Mail/FolderRenameDialog",
	component: FolderRenameDialog,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof FolderRenameDialog>;

function Live({
	initialName = "Trash",
	pending,
	error,
}: {
	initialName?: string;
	pending?: boolean;
	error?: string;
}) {
	const [name, setName] = useState(initialName);
	return (
		<div className="h-screen bg-canvas font-sans">
			<FolderRenameDialog
				open
				folderLabel="Trash"
				defaultLabel="Deleted Messages"
				name={name}
				onNameChange={setName}
				onSubmit={() => {}}
				onClose={() => {}}
				pending={pending}
				error={error}
			/>
		</div>
	);
}

export const Default: Story = {
	name: "Renaming an appointed folder",
	render: () => <Live />,
};

/** Cleared: the folder goes back to what the mail server calls it. */
export const Cleared: Story = {
	name: "Name cleared",
	render: () => <Live initialName="" />,
};

export const Saving: Story = {
	name: "Saving",
	render: () => <Live pending />,
};

export const Failed: Story = {
	name: "The save failed",
	render: () => <Live error="Couldn't save that name. Please try again." />,
};

export const Phone: Story = {
	name: "Phone",
	globals: { viewport: { value: "mobile" } },
	render: () => <Live />,
};
