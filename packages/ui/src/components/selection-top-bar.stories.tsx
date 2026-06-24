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

export const WithoutMarkRead: Story = {
	args: { count: 2, onMarkRead: undefined },
};

export const Busy: Story = { args: { count: 2, isBusy: true } };

export const CrossAccountHint: Story = {
	args: {
		count: 4,
		moveDisabledHint:
			"Move only works within one account — clear selection or pick messages from a single account",
	},
};
