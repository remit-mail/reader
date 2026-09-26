import {
	NO_QUOTABLE_BODY_FORWARD_MESSAGE,
	SMTP_MISSING_MESSAGE,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppStory } from "@/mocks/story-frame/AppStory";
import {
	composeWorld,
	INBOX,
	LONG_SUBJECT,
	LUNCH_BODY,
	LUNCH_SUBJECT,
	messageUrl,
	PLAIN_DRAFT,
	SCANS_SUBJECT,
	TURNS_SUBJECT,
	threadUrl,
	withoutSmtp,
} from "@/mocks/story-frame/compose-world";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";

const world = composeWorld();
const phone = { viewport: { value: "mobile", isRotated: false } };

const meta = {
	title: "Playground/Shipped/Mail/Compose",
	component: AppStory,
	args: { url: `/mail/${INBOX}/compose` },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: mailHandlers(world) },
	},
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

const writingSurface = async (holding: string): Promise<HTMLElement> =>
	waitFor(() => {
		const editable = document.querySelector<HTMLElement>(
			"[data-testid=compose-body]",
		);
		if (!editable?.textContent?.includes(holding))
			throw new Error(`the editor does not hold "${holding}" yet`);
		return editable;
	});

const spellMarks = (editable: HTMLElement): AbstractRange[] => {
	const ranges: AbstractRange[] = [];
	CSS.highlights.forEach((highlight, name) => {
		if (name !== "spell-error") return;
		highlight.forEach((range) => {
			if (editable.contains(range.startContainer)) ranges.push(range);
		});
	});
	return ranges;
};

const refusal = async (reason: string) => {
	const title = await page().findByText("Can't send yet");
	await expect(title.parentElement).toHaveTextContent(reason);
};

const sendFromWork = async () =>
	userEvent.selectOptions(
		await page().findByLabelText("From:"),
		"alice.tan@acme.example",
	);

const composeFirst = (compose: HTMLElement, message: HTMLElement) =>
	expect(
		compose.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();

export const Blank: Story = {
	play: async () => {
		await expect(
			await page().findByRole("heading", { name: "New Message" }),
		).toBeVisible();
		await expect(page().getByLabelText("To:")).toHaveValue("");
		await expect(page().getByPlaceholderText("Subject")).toHaveValue("");
		await expect(page().getByRole("button", { name: "Send" })).toBeVisible();
	},
};

export const Autosaves: Story = {
	play: async () => {
		await sendFromWork();
		const to = await page().findByLabelText("To:");
		await userEvent.type(to, "ada@acme.example,");
		await userEvent.type(page().getByPlaceholderText("Subject"), "Numbers");
		await expect(
			await page().findByText("Draft saved", {}, { timeout: 5000 }),
		).toBeVisible();
		await expect(
			page().getByRole("heading", { name: "Draft" }),
		).toBeInTheDocument();
	},
};

export const Spellcheck: Story = {
	args: { url: `/mail/${INBOX}/compose/out-misspelt` },
	play: async () => {
		const editable = await writingSurface("Ths report");
		await waitFor(
			async () => {
				await expect(spellMarks(editable).length).toBeGreaterThan(0);
				await expect(editable).toHaveAttribute("spellcheck", "false");
			},
			{ timeout: 5000 },
		);
		await userEvent.click(page().getByTestId("compose-language-chip"));
		const dutch = await waitFor(() => {
			const row = document.querySelector<HTMLElement>(
				'[role="menuitemradio"][lang="nl"]',
			);
			if (!row) throw new Error("the language menu is not open");
			return row;
		});
		await userEvent.click(dutch);
		await waitFor(
			async () => {
				await expect(editable).toHaveAttribute("spellcheck", "true");
				await expect(spellMarks(editable)).toHaveLength(0);
			},
			{ timeout: 5000 },
		);
	},
};

export const OverAnOpenMessage: Story = {
	args: { url: messageUrl("q3-planning") },
	play: async () => {
		const conversation = () =>
			page().queryByRole("heading", { level: 1, name: "Q3 planning" });
		await waitFor(() => expect(conversation()).toBeVisible());

		await userEvent.click(page().getByRole("button", { name: "Compose" }));
		const to = await page().findByLabelText("To:");
		await expect(to).toBeVisible();
		await expect(conversation()).toBeNull();

		await userEvent.type(to, "ada@acme.example");
		const search = page().getByLabelText("Search mail");
		await userEvent.type(search, "invoice");

		await expect(search).toHaveFocus();
		await expect(page().getAllByLabelText("To:")).toHaveLength(1);
		await waitFor(() =>
			expect(
				page().getByRole("button", { name: "Remove ada@acme.example" }),
			).toBeVisible(),
		);
		await expect(conversation()).toBeNull();
	},
};

export const Reply: Story = {
	args: { url: `${messageUrl("lunch")}/reply` },
	play: async () => {
		const subject = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(subject).toHaveValue(`Re: ${LUNCH_SUBJECT}`));
		await expect(
			page().getByRole("button", { name: "Remove ada@acme.example" }),
		).toBeVisible();
		const messages = page().getByTestId("conversation-messages");
		await composeFirst(subject, messages);
		await expect(
			(await within(messages).findAllByText(LUNCH_BODY))[0],
		).toBeVisible();
	},
};

export const Forward: Story = {
	args: { url: `${messageUrl("lunch")}/forward` },
	play: async () => {
		const subject = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(subject).toHaveValue(`Fwd: ${LUNCH_SUBJECT}`));
		await expect(page().getByLabelText("To:")).toHaveValue("");
		const quote = await page().findByRole("button", {
			name: "Ada Lovelace wrote:",
		});
		await expect(quote).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(quote);
		await expect(await page().findByText(/Forwarded message/)).toBeVisible();
	},
};

export const ReplyOverALongMessage: Story = {
	args: { url: `${messageUrl("billing")}/reply` },
	play: async () => {
		const subject = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(subject).toHaveValue(`Re: ${LONG_SUBJECT}`));
		const messages = page().getByTestId("conversation-messages");
		await composeFirst(subject, messages);
		await expect(
			await within(messages).findByText(/Point 14\./),
		).toBeInTheDocument();
	},
};

export const ReplyOverAThread: Story = {
	args: { url: `${threadUrl("venue", "venue-3")}/reply` },
	play: async () => {
		const subject = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(subject).toHaveValue(`Re: ${TURNS_SUBJECT}`));
		const messages = page().getByTestId("conversation-messages");
		await composeFirst(subject, messages);
		const newest = await within(messages).findByText(/Shall I book it/);
		const oldest = await within(messages).findByText(/Two options/);
		await composeFirst(newest, oldest);
	},
};

export const PhoneLongReplyKeepsSendInReach: Story = {
	globals: phone,
	args: { url: `${messageUrl("lunch")}/reply/out-long-reply` },
	play: async () => {
		const editable = await writingSurface("Point 24.");
		await waitFor(() =>
			expect(editable.getBoundingClientRect().height).toBeGreaterThan(
				window.innerHeight,
			),
		);
		const send = page().getByRole("button", { name: "Send" });
		const button = send.getBoundingClientRect();
		await expect(button.top).toBeGreaterThanOrEqual(0);
		await expect(button.bottom).toBeLessThanOrEqual(window.innerHeight);
	},
};

export const PhoneSheet: Story = {
	globals: phone,
	play: async () => {
		const sheet = await page().findByRole("dialog");
		await expect(within(sheet).getByText("New Message")).toBeVisible();
		await expect(within(sheet).getByLabelText("To:")).toBeVisible();
		await expect(
			within(sheet).getByRole("button", { name: "Send" }),
		).toBeVisible();
	},
};

export const PhoneKeyboardUp: Story = {
	globals: phone,
	beforeEach: () => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		Object.defineProperty(viewport, "height", {
			configurable: true,
			get: () => window.innerHeight - 320,
		});
		viewport.dispatchEvent(new Event("resize"));
		return () => {
			Reflect.deleteProperty(viewport, "height");
			viewport.dispatchEvent(new Event("resize"));
		};
	},
	play: async () => {
		const expand = await page().findByRole("button", {
			name: "Show recipients and subject",
		});
		await userEvent.click(expand);
		const to = page().getByLabelText("To:");
		await expect(to).toBeVisible();
		await userEvent.type(to, "grace@example.org");
		await expect(page().getByLabelText("To:")).toHaveValue("grace@example.org");
		await expect(
			page().queryByRole("button", { name: "Show recipients and subject" }),
		).toBeNull();
	},
};

export const PlainText: Story = {
	args: { url: `/mail/${INBOX}/compose/out-plain` },
	play: async () => {
		const editor = await page().findByTestId("compose-body-plain");
		await expect(editor.tagName).toBe("TEXTAREA");
		await waitFor(() => expect(editor).toHaveValue(PLAIN_DRAFT));
	},
};

export const SaveFailed: Story = {
	parameters: {
		msw: { handlers: mailHandlers(world, { draftSave: "refused" }) },
	},
	play: async () => {
		await sendFromWork();
		await userEvent.type(page().getByLabelText("To:"), "ada@acme.example,");
		await expect(
			await page().findByText("Save failed", {}, { timeout: 5000 }),
		).toBeVisible();
		await expect(await page().findByText("Couldn't save draft")).toBeVisible();
	},
};

export const Sending: Story = {
	args: { url: `/mail/${INBOX}/compose/out-misspelt` },
	parameters: {
		msw: { handlers: mailHandlers(world, { send: "holds" }) },
	},
	play: async () => {
		await expect(
			await page().findByRole("button", { name: "Remove ada@acme.example" }),
		).toBeVisible();
		const send = page().getByRole("button", { name: "Send" });
		await userEvent.click(send);
		await waitFor(() => expect(send).toHaveAttribute("aria-busy", "true"));
	},
};

export const SendUnavailable: Story = {
	parameters: {
		msw: { handlers: mailHandlers(withoutSmtp(world)) },
	},
	play: async () => {
		await sendFromWork();
		await expect(
			await page().findByTestId("compose-smtp-missing-banner"),
		).toBeVisible();
		await userEvent.type(page().getByLabelText("To:"), "ada@acme.example,");
		await userEvent.click(page().getByRole("button", { name: "Send" }));
		await refusal(SMTP_MISSING_MESSAGE);
		await expect(page().getByLabelText("To:")).toBeVisible();
	},
};

export const ChooseAnAccount: Story = {
	play: async () => {
		const from = await page().findByLabelText("From:");
		await expect(from).toHaveValue("");
		await userEvent.click(page().getByRole("button", { name: "Send" }));
		await refusal("Choose an account to send from.");
	},
};

export const SendWithNoRecipient: Story = {
	play: async () => {
		await sendFromWork();
		await userEvent.click(page().getByRole("button", { name: "Send" }));
		await refusal("Add a To address before sending.");
		await expect(page().getByLabelText("To:")).toBeVisible();
	},
};

export const NothingToForward: Story = {
	args: { url: `${messageUrl("scans")}/forward` },
	play: async () => {
		const subject = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(subject).toHaveValue(`Fwd: ${SCANS_SUBJECT}`));
		await expect(
			await page().findByTestId("compose-quote-missing"),
		).toBeVisible();
		await userEvent.type(page().getByLabelText("To:"), "ada@acme.example,");
		await userEvent.click(page().getByRole("button", { name: "Send" }));
		await refusal(NO_QUOTABLE_BODY_FORWARD_MESSAGE);
	},
};

export const ReplyWithNothingToQuote: Story = {
	args: { url: `${messageUrl("scans")}/reply` },
	play: async () => {
		const subject = await page().findByPlaceholderText("Subject");
		await waitFor(() => expect(subject).toHaveValue(`Re: ${SCANS_SUBJECT}`));
		const banner = await page().findByTestId("compose-quote-missing");
		await expect(banner).toBeVisible();
		await expect(
			page().getByRole("button", { name: "Send" }),
		).not.toHaveAttribute("title");
	},
};
