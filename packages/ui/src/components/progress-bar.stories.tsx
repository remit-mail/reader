import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./progress-bar.js";

const meta: Meta<typeof ProgressBar> = {
	title: "Components/ProgressBar",
	component: ProgressBar,
	parameters: { layout: "padded" },
	render: (args) => (
		<div className="w-80">
			<ProgressBar {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof ProgressBar>;

export const Started: Story = { args: { value: 340, max: 3412 } };

export const Halfway: Story = { args: { value: 1706, max: 3412 } };

export const NearlyDone: Story = { args: { value: 3072, max: 3412 } };

export const Success: Story = {
	args: { value: 3412, max: 3412, tone: "success" },
};

export const Danger: Story = {
	args: { value: 1200, max: 3412, tone: "danger" },
};

/** Total is unknown — a paging search count, before the first page resolves. */
export const Indeterminate: Story = {
	args: { value: 0, max: 0, indeterminate: true },
};
