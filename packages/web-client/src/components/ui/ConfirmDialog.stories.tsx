import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmDialog } from "./ConfirmDialog";

const meta: Meta<typeof ConfirmDialog> = {
	title: "Screens/WebClient/ConfirmDialog",
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
