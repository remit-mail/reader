import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Checkbox } from "./checkbox.js";

const meta: Meta<typeof Checkbox> = {
	title: "Components/Checkbox",
	component: Checkbox,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-sm rounded-xl border border-line bg-surface p-4">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof Checkbox>;

export const Labelled: Story = {
	render: () => {
		const [checked, setChecked] = useState(true);
		return (
			<Checkbox
				label="Move these out of Spam"
				description="You can undo this later"
				checked={checked}
				onChange={(e) => setChecked(e.target.checked)}
			/>
		);
	},
};

export const Unchecked: Story = {
	render: () => {
		const [checked, setChecked] = useState(false);
		return (
			<Checkbox
				label="Keep me posted"
				checked={checked}
				onChange={(e) => setChecked(e.target.checked)}
			/>
		);
	},
};

export const Indeterminate: Story = {
	render: () => (
		<Checkbox
			label="Some selected"
			description="Tri-state, e.g. a select-all header"
			indeterminate
			checked={false}
			onChange={() => {}}
		/>
	),
};

export const BareControl: Story = {
	name: "Bare control (no label)",
	render: () => {
		const [checked, setChecked] = useState(true);
		return (
			<div className="flex items-center gap-3">
				<Checkbox
					aria-label="Select row"
					checked={checked}
					onChange={(e) => setChecked(e.target.checked)}
				/>
				<span className="text-sm text-fg-muted">
					Embedded in a row that owns the touch target
				</span>
			</div>
		);
	},
};
