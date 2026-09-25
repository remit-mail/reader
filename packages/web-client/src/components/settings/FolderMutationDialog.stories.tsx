import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderMutationDialog } from "./FolderMutationDialog";

const meta: Meta<typeof FolderMutationDialog> = {
	title: "Playground/Shipped/Settings/Folders/FolderMutationDialog",
	component: FolderMutationDialog,
	parameters: { layout: "fullscreen" },
	args: {
		open: true,
		folderName: "Receipts",
		targetName: "Q3 Receipts",
		onRetry: () => undefined,
		onRefresh: () => undefined,
		onClose: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof FolderMutationDialog>;

export const RenameWaiting: Story = {
	name: "Rename — waiting",
	args: { intent: "rename", phase: { kind: "waiting" } },
};

export const RenameTimedOut: Story = {
	name: "Rename — timed out",
	args: { intent: "rename", phase: { kind: "timed-out" } },
};

export const RenameFailed: Story = {
	name: "Rename — failed",
	args: {
		intent: "rename",
		phase: {
			kind: "failed",
			serverMessage: "Mailbox already exists at that path.",
		},
	},
};

export const RenameConflict: Story = {
	name: "Rename — conflict",
	args: { intent: "rename", phase: { kind: "conflict" } },
};

export const DeleteWaiting: Story = {
	name: "Delete — waiting",
	args: { intent: "delete", phase: { kind: "waiting" } },
};

export const DeleteTimedOut: Story = {
	name: "Delete — timed out",
	args: { intent: "delete", phase: { kind: "timed-out" } },
};

export const DeleteFailed: Story = {
	name: "Delete — failed",
	args: {
		intent: "delete",
		phase: {
			kind: "failed",
			serverMessage: "The mailbox has folders inside it.",
		},
	},
};

export const DeleteConflict: Story = {
	name: "Delete — conflict",
	args: { intent: "delete", phase: { kind: "conflict" } },
};
