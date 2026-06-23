import type { Meta, StoryObj } from "@storybook/react";
import { SelectionTopBar } from "./selection-top-bar.js";

const meta: Meta<typeof SelectionTopBar> = {
	title: "Screens/Kit/SelectionTopBar",
	component: SelectionTopBar,
	parameters: { layout: "padded" },
	args: {
		onCancel: () => undefined,
		onMarkRead: () => undefined,
		onDelete: () => undefined,
	},
	render: (args) => (
		<div className="w-[390px] rounded-md border border-line">
			<SelectionTopBar {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof SelectionTopBar>;

export const One: Story = { args: { count: 1 } };

export const Many: Story = { args: { count: 3 } };
