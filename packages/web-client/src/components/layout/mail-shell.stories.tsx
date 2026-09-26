import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailboxIdFor, mailWorld, WORK } from "@/mocks/story-frame/mail-world";

const world = mailWorld();
const inbox = `/mail/${mailboxIdFor(WORK, "Inbox")}`;
const openInInbox = `${inbox}/thread-q3-planning/msg-q3-planning`;
const desktop = { viewport: { value: "desktop", isRotated: false } };
const phone = { viewport: { value: "mobile", isRotated: false } };

const meta = {
	title: "Playground/Shipped/Mail/Shell",
	component: AppStory,
	args: { url: "/mail/brief/thread-q3-planning/msg-q3-planning#intelligence" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
	globals: desktop,
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

const rows = (): HTMLElement[] =>
	Array.from(document.querySelectorAll<HTMLElement>("[data-list-row]"));

const conversation = () =>
	page().findByRole("heading", { level: 1, name: "Q3 planning" });

export const Default: Story = {
	play: async () => {
		await expect(await conversation()).toBeVisible();
		await expect(page().getByRole("button", { name: "Compose" })).toBeVisible();
		await expect(page().getAllByLabelText("Search mail")).toHaveLength(1);
		await waitFor(() => expect(rows().length).toBeGreaterThan(1));
		await expect(await page().findByText("Intelligence")).toBeVisible();
	},
};

export const Inbox: Story = {
	args: { url: `${openInInbox}#intelligence` },
	play: async () => {
		await expect(await conversation()).toBeVisible();
		await expect(await page().findByText("in:inbox")).toBeVisible();
		await expect(page().getByLabelText("Expand filters")).toBeVisible();
		await expect(await page().findByText("Intelligence")).toBeVisible();
	},
};

export const IntelligenceClosed: Story = {
	play: async () => {
		await expect(await conversation()).toBeVisible();
		const hide = await page().findByRole("button", {
			name: "Hide intelligence sidebar",
		});
		await userEvent.click(hide);
		const show = await page().findByRole("button", {
			name: "Show intelligence sidebar",
		});
		await expect(show).toBeEnabled();
		await waitFor(() => expect(page().queryByText("Intelligence")).toBeNull());
		await expect(await conversation()).toBeVisible();
	},
};

export const NoThreadOpen: Story = {
	args: { url: "/mail/flagged" },
	play: async () => {
		await expect(await page().findByText("Invoice #1042")).toBeVisible();
		await expect(page().getByText("Select a thread to read")).toBeVisible();
		await expect(
			page().getByRole("button", { name: "Show intelligence sidebar" }),
		).toBeDisabled();
	},
};

export const TwoPane: Story = {
	args: { url: `${openInInbox}#intelligence` },
	globals: { viewport: { value: "twoPane", isRotated: false } },
	play: async () => {
		await expect(await conversation()).toBeVisible();
		await expect(page().getByRole("button", { name: "Compose" })).toBeVisible();
		await waitFor(() => expect(rows().length).toBeGreaterThan(1));
		await expect(page().queryByText("Intelligence")).toBeNull();
	},
};

export const TabletSinglePane: Story = {
	args: { url: inbox },
	globals: { viewport: { value: "tablet", isRotated: false } },
	play: async () => {
		await expect(await page().findByText("Q3 planning")).toBeVisible();
		await expect(page().queryByRole("button", { name: "Compose" })).toBeNull();
		await expect(
			page().getByRole("button", { name: "Compose new message" }),
		).toBeVisible();
		await expect(page().getByRole("button", { name: "Search" })).toBeVisible();
		await expect(page().getByRole("button", { name: "Menu" })).toBeVisible();
	},
};

export const Phone: Story = {
	args: { url: inbox },
	globals: phone,
	play: async () => {
		await expect(await page().findByText("Q3 planning")).toBeVisible();
		await expect(
			page().getByRole("button", { name: "Compose new message" }),
		).toBeVisible();
		await expect(page().queryByText("Starred")).toBeNull();
	},
};

export const PhoneNavSlideOver: Story = {
	args: { url: inbox },
	globals: phone,
	play: async () => {
		await page().findByText("Q3 planning");
		await userEvent.click(page().getByRole("button", { name: "Menu" }));
		await expect(await page().findByText("Starred")).toBeVisible();
		await expect(page().getByText("Daily brief")).toBeVisible();
	},
};

export const Loading: Story = {
	args: { url: "/mail/brief" },
	parameters: {
		msw: { handlers: mailHandlers(world, { config: "holds" }) },
	},
	play: async () => {
		await waitFor(() =>
			expect(document.querySelector(".animate-pulse")).not.toBeNull(),
		);
		await expect(rows()).toHaveLength(0);
		await expect(page().queryByRole("button", { name: "Compose" })).toBeNull();
	},
};
