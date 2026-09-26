import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import {
	composeWorld,
	INBOX,
	messageUrl,
} from "@/mocks/story-frame/compose-world";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";

const world = composeWorld();

const meta = {
	title: "Playground/Shipped/Mail/Detail surface",
	component: AppStory,
	args: { url: "/mail/brief" },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

const rows = (): HTMLElement[] =>
	Array.from(document.querySelectorAll<HTMLElement>("[data-list-row]"));

const unsent = ["Design review notes", "Re: contract"];

const composeAndSearch = async () => {
	await userEvent.click(await page().findByRole("button", { name: "Compose" }));
	await expect(await page().findByLabelText("To:")).toBeVisible();
	const search = page().getByLabelText("Search mail");
	await userEvent.type(search, "invoice");
	await expect(search).toHaveFocus();
	await expect(page().getAllByLabelText("To:")).toHaveLength(1);
};

export const SheetOpensOverTheRail: Story = {
	args: { url: `${messageUrl("q3-planning")}#intelligence` },
	globals: { viewport: { value: "desktop", isRotated: false } },
	play: async () => {
		await expect(await page().findByText("Intelligence")).toBeInTheDocument();

		await userEvent.keyboard("?");
		const sheet = await page().findByRole("dialog", {
			name: "Keyboard shortcuts",
		});
		await expect(sheet).toBeVisible();
		await expect(page().getByText("Intelligence")).toBeInTheDocument();

		await userEvent.keyboard("j");
		await expect(page().getByRole("dialog")).toBeVisible();
		await expect(page().getByText("Intelligence")).toBeInTheDocument();

		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
		await expect(page().getByText("Intelligence")).toBeInTheDocument();
	},
};

export const DeleteConfirmOutlastsAKeystroke: Story = {
	args: { url: `/mail/${INBOX}` },
	play: async () => {
		await page().findByText("Q3 planning");
		rows()[0]?.focus();
		await userEvent.keyboard("j");
		await userEvent.keyboard("k");
		await userEvent.keyboard("#");
		const dialog = await page().findByRole("dialog");
		await expect(
			within(dialog).getByText("Move 1 message to Trash?"),
		).toBeVisible();

		await userEvent.keyboard("j");
		await expect(page().getByRole("dialog")).toBeVisible();

		await userEvent.click(
			within(dialog).getByRole("button", { name: "Cancel" }),
		);
		await waitFor(() => expect(page().queryByRole("dialog")).toBeNull());
		await expect(rows()[0]).toHaveTextContent("Q3 planning");
	},
};

export const ComposeOverTheBrief: Story = {
	play: async () => {
		await page().findByText("Q3 planning");
		await composeAndSearch();
	},
};

export const ComposeOverStarred: Story = {
	args: { url: "/mail/flagged" },
	play: async () => {
		await page().findByText("Invoice #1042");
		await composeAndSearch();
		await expect(page().getByText("Invoice #1042")).toBeVisible();
	},
};

export const ComposeOverAFolder: Story = {
	args: { url: `/mail/${INBOX}` },
	play: async () => {
		await page().findByText("Q3 planning");
		await userEvent.click(page().getByRole("button", { name: "Compose" }));
		await expect(await page().findByLabelText("To:")).toBeVisible();
		await expect(page().getByText("Q3 planning")).toBeVisible();
	},
};

export const ComposeOnThePhone: Story = {
	globals: { viewport: { value: "mobile", isRotated: false } },
	play: async () => {
		await page().findByText("Q3 planning");
		await userEvent.click(
			page().getByRole("button", { name: "Compose new message" }),
		);
		const sheet = await page().findByRole("dialog");
		await expect(within(sheet).getByLabelText("To:")).toBeVisible();
	},
};

export const EditADraftFromTheOutbox: Story = {
	args: { url: "/mail/outbox" },
	play: async () => {
		await page().findByText("Design review notes");
		const edits = page().getAllByRole("button", { name: "Edit as draft" });
		const [first] = edits;
		if (!first) throw new Error("no outbox row offers Edit as draft");
		let row: HTMLElement = first;
		while (
			row.parentElement &&
			within(row.parentElement).queryAllByRole("button", {
				name: "Edit as draft",
			}).length === 1
		)
			row = row.parentElement;
		const subject = unsent.find((candidate) =>
			row.textContent?.includes(candidate),
		);
		await userEvent.click(first);

		const field = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(field).toHaveValue(subject));
		const others = unsent.filter((candidate) => candidate !== subject);
		await expect(page().getByText(others[0] ?? "")).toBeVisible();
	},
};

export const ReplyUnderTheMessage: Story = {
	args: { url: messageUrl("q3-planning") },
	play: async () => {
		await page().findByRole("heading", { level: 1, name: "Q3 planning" });
		await userEvent.click(page().getByRole("button", { name: "Reply" }));

		const subject = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(subject).toHaveValue("Re: Q3 planning"));
		await expect(page().getByTestId("conversation-messages")).toBeVisible();

		const search = page().getByLabelText("Search mail");
		await userEvent.type(search, "invoice");
		await expect(search).toHaveFocus();
		await expect(page().getAllByLabelText("To:")).toHaveLength(1);
		await expect(subject).toHaveValue("Re: Q3 planning");
		await expect(page().getByTestId("conversation-messages")).toBeVisible();
	},
};
