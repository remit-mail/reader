import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { FolderTreeNode } from "../lib/folder-tree.js";
import {
	type PromptPhase,
	RoleAppointmentPrompt,
	type RoleAppointmentPromptProps,
} from "./role-appointment-prompt.js";

/**
 * An account with two folders that could both be Trash by name: the one holding
 * 512 messages, and the empty look-alike beside it. Telling those apart is the
 * whole reason the prompt shows counts.
 */
const FOLDERS: readonly FolderTreeNode[] = [
	{ id: "mb-inbox", label: "INBOX", path: "INBOX", messageCount: 4821 },
	{
		id: "mb-archive",
		label: "Archive",
		path: "Archive",
		messageCount: 19243,
	},
	{
		id: "mb-deleted",
		label: "Deleted Messages",
		path: "Deleted Messages",
		messageCount: 512,
	},
	{
		id: "mb-prullenbak",
		label: "Prullenbak",
		path: "Prullenbak",
		messageCount: 0,
	},
	{ id: "mb-spam", label: "Spam", path: "Spam", messageCount: 88 },
];

type HarnessProps = Omit<
	RoleAppointmentPromptProps,
	"open" | "selectedId" | "onSelect" | "onConfirm" | "onCancel" | "folders" | "delimiter"
> & { initialSelectedId?: string };

function Harness({ initialSelectedId, ...props }: HarnessProps) {
	const [selectedId, setSelectedId] = useState(initialSelectedId);
	return (
		<RoleAppointmentPrompt
			{...props}
			open
			folders={FOLDERS}
			delimiter="/"
			selectedId={selectedId}
			onSelect={setSelectedId}
			onConfirm={() => {}}
			onCancel={() => {}}
		/>
	);
}

const meta: Meta<typeof Harness> = {
	title: "Mail/RoleAppointmentPrompt",
	component: Harness,
};
export default meta;

type Story = StoryObj<typeof Harness>;

const choosing: PromptPhase = { kind: "choosing" };

/** A delete refused because the account has no Trash at all. A first choice. */
export const None: Story = {
	name: "none",
	args: {
		reason: "none",
		action: { kind: "delete", count: 12 },
		phase: choosing,
		accountEmail: "440737+mvhenten@users.noreply.github.com",
	},
};

/**
 * A delete refused because the folder the user chose is gone. The description
 * names it, so a rename (pick the renamed one) is told from a deletion.
 */
export const Stale: Story = {
	name: "stale",
	args: {
		reason: "stale",
		action: { kind: "delete", count: 12 },
		staleFolderLabel: "Prullenbak",
		phase: choosing,
	},
};

/**
 * Empty Trash on a folder reader only matched by name. The guess starts
 * selected, so the common case is one tap, and the confirm is the danger
 * variant — this is the only framing whose confirm expunges.
 */
export const Unconfirmed: Story = {
	name: "unconfirmed",
	args: {
		reason: "unconfirmed",
		action: { kind: "emptyTrash" },
		trashFolderLabel: "Deleted Messages",
		initialSelectedId: "mb-deleted",
		phase: choosing,
	},
};

/** Two writes behind one press: the appointment, then the action it unblocks. */
export const Pending: Story = {
	name: "pending",
	args: {
		reason: "none",
		action: { kind: "delete", count: 12 },
		initialSelectedId: "mb-prullenbak",
		phase: { kind: "appointing" },
	},
};

/** The write failed. The picker stays, the selection stays, the confirm stays pressable. */
export const AppointFailed: Story = {
	name: "appoint-failed",
	args: {
		reason: "none",
		action: { kind: "delete", count: 12 },
		initialSelectedId: "mb-prullenbak",
		phase: { kind: "appoint-failed", cause: "generic" },
	},
};

/**
 * The folder was made in the picker and the mail server has not confirmed it
 * yet. A different sentence with a different remedy from a network failure —
 * waiting fixes this one, retrying does not.
 */
export const AppointRefusedPendingMailbox: Story = {
	name: "appoint-refused-pending-mailbox",
	args: {
		reason: "none",
		action: { kind: "delete", count: 12 },
		initialSelectedId: "mb-prullenbak",
		phase: { kind: "appoint-failed", cause: "mailbox-pending" },
	},
};
