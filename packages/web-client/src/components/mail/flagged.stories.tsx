import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";

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

const filterToCategory = async (canvasElement: HTMLElement, name: string) => {
	const canvas = within(canvasElement);
	await userEvent.click(await canvas.findByLabelText("Expand filters"));
	const categories = await canvas.findByLabelText("Categories");
	await userEvent.click(within(categories).getByRole("button", { name }));
};

const listHeader = (canvasElement: HTMLElement): HTMLElement => {
	const title = within(canvasElement)
		.getAllByText("Starred")
		.find((element) => element.closest("header"));
	const header = title?.closest("header");
	if (!header) throw new Error("The Starred list header is not on screen");
	return header;
};

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
		await expect(canvas.getByText("Conference talk outline")).toBeVisible();
		await expect(canvas.getByText("Invoice #1042")).toBeVisible();
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

export const CountUnavailable: Story = {
	parameters: {
		msw: { handlers: mailHandlers(world, { withholdCounts: true }) },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		await expect(listHeader(canvasElement).textContent).not.toMatch(/\d/);
	},
};

export const FilteredWithResults: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Invoice #1042");
		await filterToCategory(canvasElement, "Personal");
		await waitFor(() =>
			expect(canvas.queryByText("Invoice #1042")).not.toBeInTheDocument(),
		);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
		await expect(canvas.getByText("Conference talk outline")).toBeVisible();
	},
};

export const FilteredEmpty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		await filterToCategory(canvasElement, "Newsletter");
		await expect(
			await canvas.findByText("Every message in this folder was checked."),
		).toBeVisible();
		await expect(canvas.queryByText("No messages in Starred")).toBeNull();
	},
};

export const FilteredSearchEmpty: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		await filterToCategory(canvasElement, "Newsletter");
		await canvas.findByText("Every message in this folder was checked.");
		await userEvent.type(
			canvas.getByLabelText("Search mail"),
			"planning{Enter}",
		);
		await expect(
			await canvas.findByText("No results for “planning” in Newsletter mail"),
		).toBeVisible();
		await expect(
			canvas.getByText("Every message in this folder was checked."),
		).toBeVisible();
	},
};

export const FilteredWithMorePages: Story = {
	parameters: {
		msw: { handlers: mailHandlers(world, { pageSize: 2 }) },
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		await filterToCategory(canvasElement, "Personal");
		await expect(
			await canvas.findByRole("button", { name: "Load more" }),
		).toBeEnabled();
	},
};

export const FilteredFetchingMore: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers(world, { pageSize: 2, holdLaterPages: true }),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		await filterToCategory(canvasElement, "Personal");
		await userEvent.click(
			await canvas.findByRole("button", { name: "Load more" }),
		);
		await expect(
			await canvas.findByRole("button", { name: "Loading…" }),
		).toBeDisabled();
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
