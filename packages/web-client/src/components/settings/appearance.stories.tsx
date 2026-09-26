import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";

const meta = {
	title: "Playground/Shipped/Settings/Appearance",
	component: AppStory,
	args: { url: "/settings/appearance" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Appearance: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const density = await canvas.findByRole("radiogroup", { name: "Density" });
		await expect(
			within(density).getByRole("radio", { name: "Comfortable" }),
		).toBeChecked();
		const theme = canvas.getByRole("radiogroup", { name: "Theme" });
		await expect(within(theme).getAllByRole("radio")).toHaveLength(3);
		await expect(
			canvas.getByText(/System default follows your OS preference/),
		).toBeVisible();
	},
};
