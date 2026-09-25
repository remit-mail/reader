import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/story-frame/AppStory";
import { mailHandlers } from "@/story-frame/mail-handlers";
import { mailWorld } from "@/story-frame/mail-world";

const meta = {
	title: "Playground/Shipped/Mail/Daily brief",
	component: AppStory,
	args: { url: "/mail/brief" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
		await expect(canvas.getByText("Autumn sale starts now")).toBeVisible();
	},
};

export const Phone: Story = {
	globals: { viewport: { value: "mobile", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
	},
};

export const CaughtUp: Story = {
	parameters: {
		msw: { handlers: mailHandlers(mailWorld({ threads: [] })) },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("You're caught up")).toBeVisible();
	},
};

export const FilteredToCategory: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		await userEvent.click(canvas.getByLabelText("Expand filters"));
		const categories = await canvas.findByLabelText("Categories");
		await userEvent.click(
			within(categories).getByRole("button", { name: "Newsletter" }),
		);
		await waitFor(() =>
			expect(canvas.queryByText("Q3 planning")).not.toBeInTheDocument(),
		);
		await expect(canvas.getByText("This week in type systems")).toBeVisible();
	},
};

export const ShiftArrowRange: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		canvasElement.querySelector<HTMLElement>("[data-list-row]")?.focus();
		await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
		await waitFor(() =>
			expect(canvas.getByText("2 messages selected")).toBeInTheDocument(),
		);
	},
};

export const Search: Story = {
	args: { url: "/mail/brief?q=lease" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByText("Signed lease attached"),
		).toBeVisible();
		await expect(canvas.queryByText("Dinner on Saturday?")).toBeNull();
	},
};
