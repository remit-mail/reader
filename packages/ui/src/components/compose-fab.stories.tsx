import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ComposeFab } from "./compose-fab.js";

const meta = {
	title: "Design System/Mail/ComposeFab",
	component: ComposeFab,
	args: { onCompose: fn() },
	globals: { viewport: { value: "mobile", isRotated: false } },
} satisfies Meta<typeof ComposeFab>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ args, canvasElement }) => {
		const button = within(canvasElement).getByRole("button", {
			name: "Compose new message",
		});
		await expect(button).toBeVisible();
		await userEvent.click(button);
		await expect(args.onCompose).toHaveBeenCalledOnce();
	},
};
