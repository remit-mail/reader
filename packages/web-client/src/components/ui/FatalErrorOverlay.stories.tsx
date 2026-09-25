import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { FatalError } from "@/lib/fatal-error";
import { FatalErrorScreen } from "./FatalErrorOverlay";

const meta: Meta<typeof FatalErrorScreen> = {
	title: "Playground/Shipped/App/FatalErrorOverlay",
	component: FatalErrorScreen,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof FatalErrorScreen>;

const fatal = (overrides: Partial<FatalError>): FatalError => ({
	error: new Error(overrides.message),
	message: "",
	correlationId: "a1b2c3d4-5678-90ab-cdef-1234567890ab",
	at: Date.UTC(2024, 5, 12, 10, 30),
	recoverable: true,
	...overrides,
});

export const RecoverableTransient: Story = {
	args: {
		fatal: fatal({
			message: "Request failed with status 500",
			recoverable: true,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible();
		await expect(
			canvas.queryByRole("link", { name: "Go to inbox" }),
		).toBeNull();
	},
};

export const DeterministicFatal: Story = {
	args: {
		fatal: fatal({
			message: "date value is not finite in DateTimeFormat format()",
			correlationId: "def45678-90ab-cdef-1234-567890abcdef",
			recoverable: false,
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("link", { name: "Go to inbox" }),
		).toBeVisible();
		await expect(canvas.queryByRole("button", { name: "Retry" })).toBeNull();
	},
};
