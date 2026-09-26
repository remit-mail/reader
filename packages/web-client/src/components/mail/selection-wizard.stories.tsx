import { matchDoorLabel } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailboxIdFor, mailWorld, WORK } from "@/mocks/story-frame/mail-world";
import { longPress } from "@/mocks/story-frame/touch";

const inbox = `/mail/${mailboxIdFor(WORK, "Inbox")}`;
const desktop = { viewport: { value: "desktop", isRotated: false } };

const meta = {
	title: "Playground/Shipped/Mail/Selection wizard",
	component: AppStory,
	args: { url: inbox },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
	globals: desktop,
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

const rows = (): HTMLElement[] =>
	Array.from(document.querySelectorAll<HTMLElement>("[data-list-row]"));

const tick = async (count: number) => {
	await page().findByText("Q3 planning");
	for (const row of rows().slice(0, count)) {
		const toggle = row.querySelector<HTMLElement>(
			'[aria-label="Select message"]',
		);
		if (toggle) await userEvent.click(toggle);
	}
	await page().findByText(`${count} messages selected`);
};

const openWizard = async (count: number, verb: string) => {
	await tick(count);
	await userEvent.click(page().getByRole("button", { name: verb }));
};

const cont = () =>
	userEvent.click(page().getByRole("button", { name: "Continue" }));

export const OrganizeTickedRows: Story = {
	play: async () => {
		await openWizard(3, "Organize selected messages");
		await expect(
			await page().findByText("What should this apply to?"),
		).toBeVisible();
		await expect(page().getByText(matchDoorLabel("selected", 3))).toBeVisible();
		await expect(
			page().getByText(matchDoorLabel("properties", 3)),
		).toBeVisible();
	},
};

export const OrganizePropertiesDoor: Story = {
	play: async () => {
		await openWizard(3, "Organize selected messages");
		await userEvent.click(
			await page().findByText(matchDoorLabel("properties", 3)),
		);
		await cont();
		await expect(
			await page().findByText("Which properties have to match?"),
		).toBeVisible();
	},
};

export const DeleteReview: Story = {
	play: async () => {
		await openWizard(2, "Move selected messages to Trash");
		await page().findByText("What should this apply to?");
		await cont();
		await expect(await page().findByText("Check before it runs")).toBeVisible();
	},
};

export const MoveFolder: Story = {
	play: async () => {
		await openWizard(2, "Move selected messages");
		await page().findByText("What should this apply to?");
		await cont();
		await expect(await page().findByText("Pick a destination")).toBeVisible();
		await expect(
			await page().findByRole("treeitem", { name: /Archive/ }),
		).toBeVisible();
	},
};

export const MakeThisAFilter: Story = {
	args: { url: `${inbox}?q=invoice` },
	play: async () => {
		await userEvent.click(
			await page().findByRole("button", { name: "Make this a filter" }),
		);
		await expect(
			await page().findByText("Which properties have to match?"),
		).toBeVisible();
		await waitFor(() =>
			expect(page().getAllByText(/invoice/i).length).toBeGreaterThan(0),
		);
	},
};

export const SearchThenSelect: Story = {
	args: { url: `${inbox}?q=the` },
	play: async () => {
		await page().findByText("Linus mentioned you in #design");
		for (const row of rows()) {
			const toggle = row.querySelector<HTMLElement>(
				'[aria-label="Select message"]',
			);
			if (toggle) await userEvent.click(toggle);
		}
		await page().findByText("All 2 loaded selected");
		await userEvent.click(
			page().getByRole("button", { name: "Organize selected messages" }),
		);
		await expect(
			await page().findByText("What should this apply to?"),
		).toBeVisible();
		await expect(page().getByText(matchDoorLabel("selected", 2))).toBeVisible();
	},
};

export const MakeThisAFilterFromStarred: Story = {
	args: { url: "/mail/flagged?q=invoice" },
	play: async () => {
		await userEvent.click(
			await page().findByRole("button", { name: "Make this a filter" }),
		);
		await expect(
			await page().findByText("Which properties have to match?"),
		).toBeVisible();
	},
};

export const Phone: Story = {
	args: { url: "/mail/brief" },
	globals: { viewport: { value: "mobileShort", isRotated: false } },
	play: async () => {
		await page().findByText("Q3 planning");
		const first = rows()[0];
		if (first) await longPress(first);
		await page().findByText("1 message selected");
		await userEvent.click(
			page().getByRole("button", { name: "Organize selected messages" }),
		);
		await expect(
			await page().findByText("What should this apply to?"),
		).toBeVisible();
	},
};
