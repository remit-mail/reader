import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";
import { withRuntimeConfig } from "@/mocks/story-frame/session";

const meta = {
	title: "Playground/Shipped/Settings/Advanced/Overview",
	component: AppStory,
	args: { url: "/settings/advanced" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Advanced: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("About")).toBeVisible();
		await expect(canvas.queryByText("Messages set aside")).toBeNull();
		await expect(
			canvas.queryByRole("link", { name: "Download root certificate" }),
		).toBeNull();
	},
};

export const AdvancedTlsInternal: Story = {
	beforeEach: withRuntimeConfig({ tlsMode: "internal" }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("link", { name: "Download root certificate" }),
		).toHaveAttribute("href", "/tls-root-ca.crt");
	},
};
