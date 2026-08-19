import type { Meta, StoryObj } from "@storybook/react";
import { ConfirmDialog } from "./confirm-dialog.js";

const meta: Meta<typeof ConfirmDialog> = {
	title: "Primitives/ConfirmDialog",
	component: ConfirmDialog,
	parameters: { layout: "centered" },
	args: {
		isOpen: true,
		title: "Move 3,412 messages to Trash?",
		description: "You can restore them from Trash later.",
		confirmLabel: "Move to Trash",
		destructive: true,
		onConfirm: () => undefined,
		onCancel: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof ConfirmDialog>;

/**
 * A single corner tap on the bar's delete icon used to fall straight through
 * to a delete with nothing in between — this is what now sits in the way.
 * Wording says "Move … to Trash", not "Delete": the operation is reversible
 * (IMAP delete moves to Trash), and the confirmation copy says so rather than
 * reading as final.
 */
export const Default: Story = {};

export const OneMessage: Story = {
	args: {
		title: "Move 1 message to Trash?",
	},
};

/** The mutation is in flight: the confirm button disables rather than
 *  allowing a second concurrent delete request. */
export const Busy: Story = {
	args: {
		isBusy: true,
	},
};

/** A non-destructive confirmation (no `destructive`) uses the accent
 *  affirmative styling instead of danger. */
export const NonDestructive: Story = {
	args: {
		title: "Archive 12 messages?",
		description: undefined,
		confirmLabel: "Archive",
		destructive: false,
	},
};

/**
 * Deleting mail that already sits in Trash expunges it on the server, so the
 * dialog asks that question instead of "move to Trash?" — the wording follows
 * the consequence, never the button that opened it (#845). On Flagged and the
 * brief the rows span mailboxes, and one row bound for an expunge is enough to
 * make the whole delete unrecoverable, so a mixed set is asked here too (#855).
 */
export const PermanentDelete: Story = {
	args: {
		title: "Permanently delete 12 messages?",
		description: "They are erased from the mail server and cannot be restored.",
		confirmLabel: "Delete permanently",
	},
};

/**
 * The account's Trash appointment has not resolved yet, so which of the two
 * dialogs above applies is not yet known. Rather than guess the reversible
 * wording over what may be an expunge, the copy stays neutral and the confirm
 * holds until the answer arrives.
 */
export const OutcomeUnknown: Story = {
	args: {
		title: "Delete 12 messages?",
		description: "Checking where this account files deleted mail…",
		confirmLabel: "Delete",
		isBusy: true,
	},
};
