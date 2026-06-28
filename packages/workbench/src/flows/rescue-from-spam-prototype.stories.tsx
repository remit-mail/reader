import type { Meta, StoryObj } from "@storybook/react-vite";
import { RescueFromSpam } from "./rescue-from-spam-prototype.js";

const meta: Meta<typeof RescueFromSpam> = {
	title: "Flows/Rescue from Spam",
	component: RescueFromSpam,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[760px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof RescueFromSpam>;

export const Prototype: Story = {};
