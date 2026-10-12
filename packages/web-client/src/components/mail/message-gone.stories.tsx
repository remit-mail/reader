import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { composeWorld, messageUrl } from "@/mocks/story-frame/compose-world";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";

const world = composeWorld();

const goneFromServer = http.get("/api/messages/msg-q3-planning", () =>
	HttpResponse.json(
		{
			code: "message_gone_from_server",
			message: "This message is no longer on the mail server.",
			details: { messageId: "msg-q3-planning" },
		},
		{ status: 404 },
	),
);

const meta = {
	title: "Playground/Shipped/Mail/Message gone from server",
	component: AppStory,
	args: { url: messageUrl("q3-planning") },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: [goneFromServer, ...mailHandlers(world)] },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const MovedOrDeletedElsewhere: Story = {
	play: async () => {
		await expect(
			await within(document.body).findByText(
				"This message is no longer on the mail server. It was moved or deleted in another mail app.",
			),
		).toBeVisible();
	},
};
