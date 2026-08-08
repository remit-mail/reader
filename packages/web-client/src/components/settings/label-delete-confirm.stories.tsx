import { ConfirmDialog } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { deleteLabelConfirmCopy } from "@/lib/organize/label-delete-copy";

/**
 * The cascade-aware label delete confirmation (issue #26, #335) — the generic
 * `ConfirmDialog` driven by `deleteLabelConfirmCopy`'s computed title and
 * description, exactly as `AccountLabels` in the labels settings route wires
 * it. No dedicated component exists for this; reusing `ConfirmDialog` is the
 * approved surface, not a placeholder for one.
 */
const meta: Meta<typeof ConfirmDialog> = {
	title: "Flows/Settings Labels/Delete Confirmation",
	component: ConfirmDialog,
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj<typeof ConfirmDialog>;

/** Nothing references the label — no blast-radius line under the title. */
export const Unused: Story = {
	args: {
		isOpen: true,
		...deleteLabelConfirmCopy("Receipts", 0),
		confirmLabel: "Delete label",
		destructive: true,
		onConfirm: () => undefined,
		onCancel: () => undefined,
	},
};

/** Exactly one filter applies the label — singular wording. */
export const OneFilter: Story = {
	args: {
		isOpen: true,
		...deleteLabelConfirmCopy("Receipts", 1),
		confirmLabel: "Delete label",
		destructive: true,
		onConfirm: () => undefined,
		onCancel: () => undefined,
	},
};

/** Several filters apply the label — the cascade warning names the count. */
export const SeveralFilters: Story = {
	args: {
		isOpen: true,
		...deleteLabelConfirmCopy("Receipts", 5),
		confirmLabel: "Delete label",
		destructive: true,
		onConfirm: () => undefined,
		onCancel: () => undefined,
	},
};

/** Several filters, on the dark theme. */
export const SeveralFiltersDark: Story = {
	name: "Several Filters (dark)",
	parameters: { theme: "dark" },
	args: {
		isOpen: true,
		...deleteLabelConfirmCopy("Receipts", 5),
		confirmLabel: "Delete label",
		destructive: true,
		onConfirm: () => undefined,
		onCancel: () => undefined,
	},
};

/** The delete is in flight — confirm disables rather than allowing a second
 *  concurrent delete. */
export const Busy: Story = {
	args: {
		isOpen: true,
		...deleteLabelConfirmCopy("Receipts", 5),
		confirmLabel: "Delete label",
		destructive: true,
		isBusy: true,
		onConfirm: () => undefined,
		onCancel: () => undefined,
	},
};
