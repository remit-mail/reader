import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import {
	HOUR,
	mailboxIdFor,
	mailWorld,
	PERSONAL,
	threadRow,
	WORK,
} from "@/mocks/story-frame/mail-world";

const base = mailWorld();
const world = {
	...base,
	threads: [
		...base.threads,
		threadRow({
			id: "spam-invoice",
			accountId: PERSONAL,
			role: "Junk",
			fromName: "Accounts Dept",
			fromEmail: "billing@lottery.example",
			subject: "Overdue invoice, act now",
			snippet: "Pay within 24 hours to avoid suspension.",
			category: "marketing",
			ago: 3 * HOUR,
		}),
		threadRow({
			id: "spam-invoice-2",
			accountId: PERSONAL,
			role: "Junk",
			fromName: "Prize Desk",
			fromEmail: "claims@lottery.example",
			subject: "Invoice for your prize",
			snippet: "Claim your prize by settling the attached invoice.",
			category: "marketing",
			ago: 4 * HOUR,
		}),
	],
};
const inbox = mailboxIdFor(WORK, "Inbox");
const junk = mailboxIdFor(PERSONAL, "Junk");
const phone = { viewport: { value: "mobile", isRotated: false } };
const widePhone = { viewport: { value: "mobileShort", isRotated: false } };

const meta = {
	title: "Playground/Shipped/Mail/Search",
	component: AppStory,
	args: { url: "/mail/brief?q=invoice" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

const shown = async (text: string): Promise<HTMLElement> => {
	const [match] = await page().findAllByText(
		(_, element) =>
			element?.textContent === text &&
			![...element.children].some((child) => child.textContent === text),
	);
	if (!match) throw new Error(`"${text}" is not on screen`);
	return match;
};

const skeletonRows = (): number =>
	document.querySelectorAll(".animate-pulse").length;

const openPhoneSearch = async () => {
	await page().findByText("Q3 planning");
	await userEvent.click(page().getByRole("button", { name: "Search" }));
};

const recentSearches = {
	beforeEach: () => {
		localStorage.setItem(
			"remit.recentSearches",
			JSON.stringify(["invoice", "from:ada"]),
		);
		return () => localStorage.removeItem("remit.recentSearches");
	},
};

export const Global: Story = {
	play: async () => {
		await expect(await shown("Invoice #1042")).toBeVisible();
		await expect(page().queryByText("Overdue invoice, act now")).toBeNull();
		const offer = await page().findByRole("button", { name: "Go to Spam" });
		await expect(offer.parentElement).toHaveTextContent("2 results from Spam");
		await expect(page().queryByText("Q3 planning")).toBeNull();
	},
};

export const GoToSpam: Story = {
	play: async () => {
		await userEvent.click(
			await page().findByRole("button", { name: "Go to Spam" }),
		);
		await expect(
			await page().findByText("Overdue invoice, act now"),
		).toBeVisible();
		await expect(page().getByText("Invoice for your prize")).toBeVisible();
		await expect(page().queryByText("Invoice #1042")).toBeNull();
	},
};

export const ScopedToSpam: Story = {
	args: { url: `/mail/${junk}?q=invoice` },
	play: async () => {
		await expect(
			await page().findByText("Overdue invoice, act now"),
		).toBeVisible();
		await expect(
			page().queryByRole("button", { name: "Go to Spam" }),
		).toBeNull();
	},
};

export const ScopedToFolder: Story = {
	args: { url: `/mail/${inbox}?q=invoice` },
	play: async () => {
		await expect(await shown("Invoice #1042")).toBeVisible();
		await expect(page().queryByText("Q3 planning")).toBeNull();
		await expect(page().queryByText("Overdue invoice, act now")).toBeNull();
		await expect(
			page().getByRole("button", { name: "Make this a filter" }),
		).toBeVisible();
	},
};

export const UnsearchedFolder: Story = {
	args: { url: `/mail/${inbox}` },
	play: async () => {
		await expect(await page().findByText("Q3 planning")).toBeVisible();
		await expect(page().getByLabelText("Expand filters")).toBeVisible();
		await expect(
			page().queryByRole("button", { name: "Make this a filter" }),
		).toBeNull();
	},
};

export const NothingToConvert: Story = {
	args: { url: `/mail/${inbox}?q=has:attachment` },
	play: async () => {
		await userEvent.click(
			await page().findByRole("button", { name: "Make this a filter" }),
		);
		await expect(
			await page().findByText(/isn't a filter condition/, { selector: "p" }),
		).toBeVisible();
	},
};

export const Loading: Story = {
	args: { url: "/mail/brief" },
	parameters: {
		msw: { handlers: mailHandlers(world, { search: "holds" }) },
	},
	play: async () => {
		await page().findByText("Q3 planning");
		await userEvent.type(page().getByLabelText("Search mail"), "invoice");
		await waitFor(() => expect(skeletonRows()).toBeGreaterThan(0));
		await expect(page().queryByText("Invoice #1042")).toBeNull();
	},
};

export const NoMatches: Story = {
	args: { url: "/mail/brief?q=hedgehog" },
	play: async () => {
		await expect(
			await page().findByText("No threads match these filters."),
		).toBeVisible();
	},
};

export const SuggestingTokens: Story = {
	args: { url: `/mail/${inbox}` },
	globals: { viewport: { value: "tablet", isRotated: false } },
	play: async () => {
		await page().findByText("Q3 planning");
		await userEvent.click(page().getByRole("button", { name: "Search" }));
		await userEvent.type(page().getByLabelText("Search mail"), "is:u");
		const suggestions = await page().findByRole("listbox", {
			name: "Search suggestions",
		});
		await expect(
			within(suggestions).getByRole("option", { name: "Unread" }),
		).toBeVisible();
	},
};

export const PhoneTakeover: Story = {
	args: { url: `/mail/${inbox}` },
	globals: phone,
	play: async () => {
		await openPhoneSearch();
		await userEvent.type(page().getByLabelText("Search mail"), "invoice");
		await expect(await shown("Invoice #1042")).toBeVisible();
		await expect(
			page().getByRole("button", { name: "Clear and close search" }),
		).toBeVisible();
	},
};

export const PhoneWithFilterTokens: Story = {
	args: { url: "/mail/brief" },
	globals: phone,
	play: async () => {
		await openPhoneSearch();
		await userEvent.type(
			page().getByLabelText("Search mail"),
			"from:billing invoice",
		);
		await expect(await shown("Invoice #1042")).toBeVisible();
		await expect(
			await page().findByRole("button", { name: /^Remove filter: .*billing/ }),
		).toBeVisible();
	},
};

export const PhoneBriefTakeover: Story = {
	args: { url: "/mail/brief" },
	globals: widePhone,
	play: async () => {
		await openPhoneSearch();
		await userEvent.type(page().getByLabelText("Search mail"), "invoice");
		await expect(await shown("Invoice #1042")).toBeVisible();
		await expect(
			page().getByRole("button", { name: "Clear and close search" }),
		).toBeVisible();
	},
};

export const PhoneFolderTakeover: Story = {
	args: { url: `/mail/${inbox}` },
	globals: widePhone,
	play: async () => {
		await openPhoneSearch();
		await userEvent.type(page().getByLabelText("Search mail"), "invoice");
		await expect(await shown("Invoice #1042")).toBeVisible();
		await expect(
			page().getByRole("button", { name: "Make this a filter" }),
		).toBeVisible();
	},
};

export const PhoneSuggestingFolders: Story = {
	args: { url: "/mail/brief" },
	globals: widePhone,
	play: async () => {
		await openPhoneSearch();
		await userEvent.type(page().getByLabelText("Search mail"), "in:");
		const suggestions = await page().findByRole("listbox", {
			name: "Search suggestions",
		});
		await expect(
			within(suggestions).getByRole("option", { name: /Archive/ }),
		).toBeVisible();
	},
};

export const PhoneRecentSearches: Story = {
	...recentSearches,
	args: { url: `/mail/${inbox}` },
	globals: phone,
	play: async () => {
		await openPhoneSearch();
		await expect(await page().findByText("from:ada")).toBeVisible();
		await userEvent.click(page().getByText("invoice"));
		await expect(page().getByLabelText("Search mail")).toHaveValue("invoice");
		await expect(await shown("Invoice #1042")).toBeVisible();
	},
};
