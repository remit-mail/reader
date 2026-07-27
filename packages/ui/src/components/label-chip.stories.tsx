import type { Meta, StoryObj } from "@storybook/react";
import { labelColorOptions } from "../lib/label-color.js";
import { LabelChip } from "./label-chip.js";

const meta: Meta<typeof LabelChip> = {
	title: "Primitives/LabelChip",
	component: LabelChip,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof LabelChip>;

/** A chip in each color the picker offers — the dot is the only thing that varies. */
export const AllColors: Story = {
	render: () => (
		<div className="flex flex-wrap gap-2">
			{labelColorOptions.map((color) => (
				<LabelChip
					key={color}
					label={{ labelId: `lbl-${color}`, name: color, color }}
				/>
			))}
		</div>
	),
};

/** Same colors against the dark theme, so the dot keeps contrast either way. */
export const AllColorsDark: Story = {
	name: "All Colors (dark)",
	parameters: { theme: "dark" },
	render: () => (
		<div className="flex flex-wrap gap-2">
			{labelColorOptions.map((color) => (
				<LabelChip
					key={color}
					label={{ labelId: `lbl-${color}`, name: color, color }}
				/>
			))}
		</div>
	),
};

/** A long name truncates rather than growing the chip. */
export const LongName: Story = {
	args: {
		label: {
			labelId: "lbl-long",
			name: "Quarterly compliance filings that need a second look",
			color: "Purple",
		},
		className: "max-w-40",
	},
};

/** The removable variant — the manual "just these" unlabel action. */
export const Removable: Story = {
	args: {
		label: { labelId: "lbl-receipts", name: "Receipts", color: "Blue" },
		onRemove: () => undefined,
	},
};

/** Removable, on the dark theme. */
export const RemovableDark: Story = {
	name: "Removable (dark)",
	parameters: { theme: "dark" },
	args: {
		label: { labelId: "lbl-receipts", name: "Receipts", color: "Blue" },
		onRemove: () => undefined,
	},
};
