import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppStory } from "@/story-frame/AppStory";
import { mailHandlers } from "@/story-frame/mail-handlers";
import { mailWorld } from "@/story-frame/mail-world";

const world = mailWorld();

const meta = {
	title: "Playground/Shipped/Mail/Flagged",
	component: AppStory,
	args: { url: "/mail/flagged" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
		await expect(canvas.getByText("Conference talk outline")).toBeVisible();
		await expect(canvas.queryByText("Dinner on Saturday?")).toBeNull();
	},
};

export const Phone: Story = {
	globals: { viewport: { value: "mobile", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
	},
};

export const Empty: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers({
				...world,
				threads: world.threads.filter((row) => !row.hasStars),
			}),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("No messages in Starred"),
		).toBeVisible();
	},
};
