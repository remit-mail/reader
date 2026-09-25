import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/story-frame/AppStory";
import { mailHandlers } from "@/story-frame/mail-handlers";
import { mailWorld, newsletterBacklog } from "@/story-frame/mail-world";
import { longPress } from "@/story-frame/touch";

const world = mailWorld();

const meta = {
	title: "Playground/Shipped/Mail/Daily brief",
	component: AppStory,
	args: { url: "/mail/brief" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const phone = { viewport: { value: "mobile", isRotated: false } };

const rows = (canvasElement: HTMLElement): HTMLElement[] =>
	Array.from(canvasElement.querySelectorAll<HTMLElement>("[data-list-row]"));

const ticked = (canvasElement: HTMLElement): number =>
	rows(canvasElement).filter((row) =>
		row.querySelector('[aria-label="Deselect message"]'),
	).length;

const openFilters = async (
	canvasElement: HTMLElement,
	label: "Expand filters" | "Search filters" = "Expand filters",
) => {
	const canvas = within(canvasElement);
	await userEvent.click(await canvas.findByLabelText(label));
};

const pick = async (
	canvasElement: HTMLElement,
	group: "Accounts" | "Categories" | "Attributes",
	name: string,
) => {
	const fieldset = await within(canvasElement).findByLabelText(group);
	await userEvent.click(within(fieldset).getByRole("button", { name }));
};

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
		await expect(canvas.getByText("Autumn sale starts now")).toBeVisible();
	},
};

export const Phone: Story = {
	globals: phone,
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
		await openFilters(canvasElement);
		await pick(canvasElement, "Categories", "Newsletter");
		await waitFor(() =>
			expect(canvas.queryByText("Q3 planning")).not.toBeInTheDocument(),
		);
		await expect(
			await canvas.findByText("This week in type systems"),
		).toBeVisible();
	},
};

export const WorkOnly: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Dinner on Saturday?");
		await openFilters(canvasElement);
		await pick(canvasElement, "Accounts", "alice.tan");
		await waitFor(() =>
			expect(canvas.queryByText("Dinner on Saturday?")).not.toBeInTheDocument(),
		);
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
	},
};

export const SelectAllThenNarrow: Story = {
	parameters: {
		msw: {
			handlers: mailHandlers(
				mailWorld({
					threads: [...world.threads, ...newsletterBacklog(14)],
				}),
			),
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		await expect(
			await canvas.findByRole("button", { name: /^Show (all|\d+ more)/ }),
		).toBeVisible();
		await openFilters(canvasElement);

		const firstRow = rows(canvasElement)[0];
		firstRow?.focus();
		await expect(document.activeElement).toBe(firstRow);
		await userEvent.keyboard("{Meta>}a{/Meta}");
		await waitFor(() =>
			expect(
				canvas.getByText(/(loaded selected|messages? selected)$/),
			).toHaveTextContent(`All ${rows(canvasElement).length} loaded selected`),
		);
		const selectedEverywhere = ticked(canvasElement);

		await expect(selectedEverywhere).toBe(rows(canvasElement).length);

		await pick(canvasElement, "Categories", "Newsletter");
		await expect(
			await canvas.findByText("Issue 1: notes from the field"),
		).toBeVisible();
		await waitFor(() => expect(ticked(canvasElement)).toBe(0));
		await expect(
			canvas.queryByText(/(loaded selected|messages? selected)$/),
		).toBeNull();
	},
};

export const ShiftArrowRange: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		rows(canvasElement)[0]?.focus();
		await userEvent.keyboard("j");
		await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
		await waitFor(() =>
			expect(canvas.getByText("2 messages selected")).toBeInTheDocument(),
		);
	},
};

export const OpenWithJ: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		rows(canvasElement)[0]?.focus();
		await userEvent.keyboard("j");
		await waitFor(() =>
			expect(
				canvas.getAllByText("Here is the countersigned copy for your records."),
			).toHaveLength(2),
		);
	},
};

export const MultiSelect: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		const [first, , third] = rows(canvasElement);
		for (const row of [first, third]) {
			const toggle = row?.querySelector<HTMLElement>(
				'[aria-label="Select message"]',
			);
			if (toggle) await userEvent.click(toggle);
		}
		await expect(await canvas.findByText("2 messages selected")).toBeVisible();
	},
};

export const MultiSelectPhone: Story = {
	globals: phone,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Q3 planning");
		const first = rows(canvasElement)[0];
		if (first) await longPress(first);
		await expect(await canvas.findByText("1 message selected")).toBeVisible();
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

export const SearchWithChips: Story = {
	args: { url: "/mail/brief?q=your" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByText("Signed lease attached");
		await openFilters(canvasElement);
		await pick(canvasElement, "Attributes", "Unread");
		await waitFor(() =>
			expect(canvas.getByLabelText("Search mail")).toHaveValue(
				"your is:unread",
			),
		);
	},
};

export const SearchOfChipsOnly: Story = {
	args: { url: "/mail/brief?q=is:unread" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const offer = await canvas.findByRole("button", {
			name: "Make this a filter",
		});
		await userEvent.click(offer);
		await expect(
			await canvas.findByText(/isn't a filter condition/, { selector: "p" }),
		).toBeVisible();
	},
};

export const SearchHitOutsideTheBrief: Story = {
	args: { url: "/mail/brief?q=outline" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByText("Conference talk outline"));
		await waitFor(() =>
			expect(
				canvas.getAllByText("Here is the rough structure for the keynote."),
			).toHaveLength(2),
		);
	},
};
