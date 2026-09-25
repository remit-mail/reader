import type { Meta, StoryObj } from "@storybook/react";
import { Folder } from "lucide-react";
import { cn } from "../lib/cn.js";
import {
	FolderSyncBadge,
	type FolderSyncState,
	isFolderSyncNavigable,
} from "./folder-sync-state.js";

const meta: Meta<typeof FolderSyncBadge> = {
	title: "Design System/Mail/FolderSyncState",
	tags: ["proposed"],
	component: FolderSyncBadge,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof FolderSyncBadge>;

function FolderRowPreview({
	label,
	state,
}: {
	label: string;
	state: FolderSyncState;
}) {
	const navigable = isFolderSyncNavigable(state);
	return (
		<div className="w-[320px] overflow-hidden rounded-lg border border-line bg-surface font-sans">
			<div
				className={cn(
					"flex min-h-11 items-center gap-2 px-3 py-2.5",
					!navigable && "opacity-60",
				)}
			>
				<Folder className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
				<span className="min-w-0 flex-1 truncate text-sm text-fg">{label}</span>
				<FolderSyncBadge state={state} />
			</div>
		</div>
	);
}

export const Healthy: Story = {
	name: "Healthy",
	render: () => (
		<FolderRowPreview label="Receipts" state={{ kind: "healthy" }} />
	),
};

export const Creating: Story = {
	name: "Creating",
	render: () => (
		<FolderRowPreview label="Receipts" state={{ kind: "creating" }} />
	),
};

export const Renaming: Story = {
	name: "Renaming",
	render: () => (
		<FolderRowPreview
			label="Receipts"
			state={{ kind: "renaming", target: "Q3 Receipts" }}
		/>
	),
};

export const Deleting: Story = {
	name: "Deleting",
	render: () => (
		<FolderRowPreview label="Receipts" state={{ kind: "deleting" }} />
	),
};

export const RenameFailed: Story = {
	name: "Rename failed",
	render: () => (
		<FolderRowPreview
			label="Receipts"
			state={{ kind: "rename-failed", target: "Q3 Receipts" }}
		/>
	),
};

export const DeleteFailed: Story = {
	name: "Delete failed",
	render: () => (
		<FolderRowPreview label="Receipts" state={{ kind: "delete-failed" }} />
	),
};
