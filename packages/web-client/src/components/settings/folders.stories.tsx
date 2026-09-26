import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import {
	accountWithFolders,
	foldersOf,
	mailWorld,
} from "@/mocks/story-frame/mail-world";
import { makeMailbox } from "@/test-support/fixtures";

const ACCOUNT_ID = "acc-work";
const EMAIL = "alice@northwind.example";

const folder = (path: string, messageCount: number) =>
	makeMailbox({
		accountId: ACCOUNT_ID,
		mailboxId: `mbx-${path.toLowerCase().replaceAll("/", "-")}`,
		fullPath: path,
		messageCount,
	});

const world = mailWorld({
	accounts: [accountWithFolders(ACCOUNT_ID, EMAIL, "Work")],
	mailboxes: [
		...foldersOf(ACCOUNT_ID),
		folder("Travel", 0),
		folder("Travel/Flights", 41),
		folder("Travel/Hotels", 96),
		folder("Finance", 0),
		folder("Finance/Invoices", 12),
		folder("Family", 230),
	],
});

const meta = {
	title: "Playground/Shipped/Settings/Folder roles",
	component: AppStory,
	args: { url: "/settings/folders" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = within(document.body);

export const Desktop: Story = {
	globals: { viewport: { value: "desktop", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("heading", { name: `Your folders — ${EMAIL}` }),
		).toBeVisible();
		await expect(
			canvas.getByRole("tree", { name: `All folders for ${EMAIL}` }),
		).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Rename Travel" }),
		).toBeInTheDocument();
	},
};

export const Phone: Story = {
	globals: { viewport: { value: "mobile", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("tree", { name: `All folders for ${EMAIL}` }),
		).toBeVisible();
	},
};

export const Renaming: Story = {
	globals: { viewport: { value: "desktop", isRotated: false } },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "Rename Travel" }),
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Rename Travel" }),
		);
		await expect(dialog.getByRole("textbox")).toBeVisible();
	},
};
