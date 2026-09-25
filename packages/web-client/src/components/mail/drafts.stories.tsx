import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppStory } from "@/story-frame/AppStory";
import { mailHandlers } from "@/story-frame/mail-handlers";
import { mailboxIdFor, mailWorld, PERSONAL } from "@/story-frame/mail-world";

const world = mailWorld();
const draftsMailboxId = mailboxIdFor(PERSONAL, "Drafts");

const meta = {
	title: "Playground/Shipped/Mail/Drafts",
	component: AppStory,
	args: { url: `/mail/${draftsMailboxId}` },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Segmented: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Not yet sent (Remit)")).toBeVisible();
		await expect(canvas.getByText("On the server")).toBeVisible();
		await expect(canvas.getByText("Re: Q3 planning")).toBeVisible();
		await expect(canvas.getByText("Re: Conference talk outline")).toBeVisible();
	},
};

export const Phone: Story = {
	globals: { viewport: { value: "mobile", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Not yet sent (Remit)")).toBeVisible();
	},
};

export const Empty: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers({
				...world,
				threads: world.threads.filter(
					(row) => row.mailboxId !== draftsMailboxId,
				),
				outbox: world.outbox.filter((message) => message.status !== "draft"),
			}),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("No drafts")).toBeVisible();
	},
};
