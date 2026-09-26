import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ComposeBodySkeleton } from "./compose-body-skeleton.js";

const meta = {
	title: "Design System/Compose/ComposeBodySkeleton",
	component: ComposeBodySkeleton,
	decorators: [
		(Story) => (
			<div className="h-80 w-[560px] border border-line bg-canvas">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ComposeBodySkeleton>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Loading: Story = {
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByTestId("compose-body-skeleton"),
		).toBeVisible();
	},
};
