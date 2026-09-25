import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppStory } from "@/story-frame/AppStory";
import { mailHandlers } from "@/story-frame/mail-handlers";
import { mailWorld } from "@/story-frame/mail-world";

const meta = {
	title: "Playground/Shipped/Mail/Outbox",
	component: AppStory,
	args: { url: "/mail/outbox" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const AllStatuses: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Design review notes")).toBeVisible();
		await expect(canvas.getByText("Weekly update")).toBeVisible();
		await expect(canvas.getByText("Re: contract")).toBeVisible();
	},
};

export const Phone: Story = {
	globals: { viewport: { value: "mobile", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Design review notes")).toBeVisible();
	},
};

export const Empty: Story = {
	parameters: {
		msw: { handlers: mailHandlers(mailWorld({ outbox: [] })) },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("No outbox messages")).toBeVisible();
	},
};
