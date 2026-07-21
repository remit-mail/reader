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

/**
 * An escalated (search-predicate) delete: the count was paged once by
 * `countMatches` and the delete re-pages the same predicate independently, so
 * it is not provably the number that gets deleted (#109). "about" and the
 * description say so up front rather than stating an exact number the run may
 * not honour.
 */
export const EscalatedEstimate: Story = {
	args: {
		title: "Move about 3,412 messages to Trash?",
		description:
			"This count is a snapshot — new mail arriving during the delete won't be included. You can restore what's deleted from Trash later.",
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
