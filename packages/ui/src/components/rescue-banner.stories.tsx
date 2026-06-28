import type { Meta, StoryObj } from "@storybook/react-vite";
import { RescueBanner } from "./rescue-banner.js";

const meta: Meta<typeof RescueBanner> = {
	title: "Components/RescueBanner",
	component: RescueBanner,
	parameters: { layout: "padded" },
	args: { onReview: () => {} },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-md">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof RescueBanner>;

export const Several: Story = {
	args: { count: 5 },
};

export const One: Story = {
	args: { count: 1 },
};

export const Dismissable: Story = {
	args: { count: 3, onDismiss: () => {} },
};
