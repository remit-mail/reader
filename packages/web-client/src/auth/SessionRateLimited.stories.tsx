import type { Meta, StoryObj } from "@storybook/react-vite";
import { SessionRateLimited } from "./SessionRateLimited";

/**
 * What a 429 on the session lookup looks like (#441). Before this state
 * existed the gate fell through to the sign-in screen, so a throttled instance
 * told everyone behind the address that they had been logged out.
 */
const meta: Meta<typeof SessionRateLimited> = {
	title: "Auth/SessionRateLimited",
	component: SessionRateLimited,
	parameters: { layout: "fullscreen" },
	args: {
		onRetry: () => undefined,
		onReport: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof SessionRateLimited>;

export const Default: Story = {};

export const Dark: Story = {
	parameters: { theme: "dark" },
};
