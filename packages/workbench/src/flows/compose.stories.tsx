import {
	type AddressEntry,
	Banner,
	ComposeActionBar,
	ComposeAddressField,
	ComposeBodySkeleton,
	ComposeFormShell,
	ComposeHeader,
	ComposeQuoteMissingBanner,
	type ComposeQuoteMode,
	type ComposeSaveState,
	type ComposeSendState,
	type ComposeShellLayout,
	ComposeSmtpMissingBanner,
	ComposeSubjectField,
	composeHeaderSummary,
	ExpandedMessage,
	inboxFilterConfig,
	NO_QUOTABLE_BODY_FORWARD_MESSAGE,
	QuotedText,
	type RichTextValue,
	SMTP_MISSING_MESSAGE,
	type ThreadMessageData,
} from "@remit/ui";
import {
	ComposeBody,
	type ComposeBodyMode,
	type ConversionFailure,
	type SpellcheckOptions,
} from "@remit/ui/rich-text";
import { openSpellcheckWorker } from "@remit/ui/spellcheck-worker";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { allThreads, q3Intelligence, q3Thread } from "../fixtures/workspace.js";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * The compose surface (#788), assembled from the components the app assembles
 * it from: the shell, the header, the writing surface and the action bar are
 * all the shipped ones, so a control that changes there changes here. What the
 * live `ComposeForm` adds around this is the wiring — the draft autosave, the
 * send mutation and the account query — not the surface.
 *
 * Compose is a surface inside the app, not beside it: on desktop it takes the
 * reading pane over while the list and the top bar stay put, and on the phone
 * it is a sheet over the single pane.
 */

const meta: Meta = {
	title: "Flows/Compose",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const mailbox = {
	selectedNavId: "mbx_personal_inbox",
	listTitle: "Inbox",
	unreadCount: 9,
	sections: [{ id: "inbox", threads: allThreads }],
	preset: inboxFilterConfig(),
};

const DEFAULT_BODY =
	"<p>Thanks — that works for me. I'll send the deck tomorrow.</p>";

/** A draft of the length someone writes on a phone — several screens of it. */
const LONG_DRAFT = [
	"<p>That works. Before Thursday, three things I want written down:</p>",
	...Array.from(
		{ length: 24 },
		(_, index) =>
			`<p>Point ${index + 1}. Whoever owns the dunning mail after self-serve ships also owns the invoice numbering, and today those are two different people on two different rotas.</p>`,
	),
].join("");

const DEFAULT_PLAIN_BODY = [
	"Thanks — that works for me.",
	"",
	"| Region | Total |",
	"| --- | --- |",
	"| EMEA | 412 |",
].join("\n");

const ACCOUNT_LANGUAGES = ["en", "nl", "de"];

/**
 * The checker the live form hands the composer: a worker per language, opened
 * for whatever the chip and detection settle on. The word list behind it is
 * still the placeholder, so ordinary English comes back misspelt — what the
 * story shows is the wiring, not the dictionary.
 */
const composeSpellcheck: SpellcheckOptions = { provider: openSpellcheckWorker };

const MISSPELT_DRAFT =
	"<p>Ths report is redy today, and the notes are attachd.</p>";

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

const writingSurface = (canvasElement: HTMLElement): HTMLElement => {
	const editable = canvasElement.querySelector<HTMLElement>(
		"[data-testid=compose-body]",
	);
	if (!editable) throw new Error("the editor is not mounted");
	return editable;
};

// Discard closes the composer and Configure leaves for Settings. Neither has a
// surface to act on here, so they report into the Actions panel rather than
// swallowing the press.
const discard = fn().mockName("onDiscard");
const configureSmtp = fn().mockName("onConfigure");

const FromRow = ({ email }: { email: string }) => (
	<div className="flex items-start gap-2">
		{/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label for a read-only value, not a form control */}
		<label className="text-sm text-fg-muted shrink-0 w-12 pt-1.5">From:</label>
		<div className="text-sm py-1.5">{email}</div>
	</div>
);

interface ComposerProps {
	to?: AddressEntry[];
	subject?: string;
	body?: string;
	plainBody?: string;
	mode?: ComposeBodyMode;
	save?: ComposeSaveState;
	send?: ComposeSendState;
	onBlocked?: (reason: string) => void;
	onSend?: () => void;
	smtpMissing?: boolean;
	quoted?: string;
	quotedSender?: string;
	/**
	 * The source is attachments only, so there is no quote to show. Which of the
	 * two answers is being written decides what the banner says and whether Send
	 * can act at all.
	 */
	quoteMissing?: ComposeQuoteMode;
	/** Renders the skeleton the app shows while the body's chunk loads. */
	bodyLoading?: boolean;
	collapsedHeader?: boolean;
	/** The shape the surface takes — a window that fills its pane, or a block
	 * of the conversation that grows with what is written in it. */
	layout?: ComposeShellLayout;
}

/**
 * How long the live form's autosave waits after the last keystroke. The story
 * runs the same debounce so the status under the Send button moves the way it
 * moves in the app.
 */
const AUTOSAVE_MS = 700;

const Composer = ({
	to = [{ email: "ada@example.com", displayName: "Ada Lovelace" }],
	subject = "Re: Q3 planning",
	body = DEFAULT_BODY,
	plainBody = DEFAULT_PLAIN_BODY,
	mode = "rich",
	save = { status: "idle" },
	send,
	onBlocked = () => undefined,
	onSend = () => undefined,
	smtpMissing = false,
	quoted,
	quotedSender,
	quoteMissing,
	bodyLoading = false,
	collapsedHeader = false,
	layout = "fill",
}: ComposerProps) => {
	const [toAddresses, setToAddresses] = useState(to);
	const [ccAddresses, setCcAddresses] = useState<AddressEntry[]>([]);
	const [bccAddresses, setBccAddresses] = useState<AddressEntry[]>([]);
	const [showCc, setShowCc] = useState(false);
	const [showBcc, setShowBcc] = useState(false);
	const [subjectValue, setSubjectValue] = useState(subject);
	const [bodyMode, setBodyMode] = useState<ComposeBodyMode>(mode);
	const [collapsed, setCollapsed] = useState(collapsedHeader);
	const [conversionFailure, setConversionFailure] =
		useState<ConversionFailure>();
	const [edits, setEdits] = useState(0);
	const [saving, setSaving] = useState(false);

	// The editor reports its document and its language on mount as well as on
	// every edit, and Lexical reports again whenever it normalises what it was
	// seeded with. Neither is somebody typing, so the status has to move on a
	// document that actually differs from the one last reported.
	const reported = useRef<RichTextValue | undefined>(undefined);
	const noteEdit = () => setEdits((count) => count + 1);

	const noteBodyChange = (value: RichTextValue) => {
		const previous = reported.current;
		reported.current = value;
		if (!previous) return;
		if (previous.html === value.html && previous.text === value.text) return;
		noteEdit();
	};

	useEffect(() => {
		if (edits === 0) return;
		setSaving(true);
		const timer = setTimeout(() => setSaving(false), AUTOSAVE_MS);
		return () => clearTimeout(timer);
	}, [edits]);

	// The tag the draft goes out under is part of the draft, so a language the
	// user picks is an edit — as it is in the live form, where the same value is
	// a dependency of the autosave.
	const language = useRef<string | undefined>(undefined);
	const noteLanguageChange = (next: string) => {
		const previous = language.current;
		language.current = next;
		if (previous === undefined || previous === next) return;
		noteEdit();
	};

	const editAddresses =
		(apply: (next: AddressEntry[]) => void) => (next: AddressEntry[]) => {
			apply(next);
			noteEdit();
		};

	const sendState: ComposeSendState =
		send ??
		(toAddresses.length === 0
			? { status: "blocked", reason: "Add a To address before sending." }
			: { status: "ready" });

	return (
		<ComposeFormShell
			layout={layout}
			banner={
				smtpMissing || conversionFailure || quoteMissing ? (
					<>
						{smtpMissing && (
							<ComposeSmtpMissingBanner onConfigure={configureSmtp} />
						)}
						{quoteMissing && <ComposeQuoteMissingBanner mode={quoteMissing} />}
						{conversionFailure && (
							<Banner
								tone="danger"
								data-testid="compose-conversion-error"
								onDismiss={() => setConversionFailure(undefined)}
							>
								<p className="font-medium">{conversionFailure.title}</p>
								<p>{conversionFailure.detail}</p>
							</Banner>
						)}
					</>
				) : undefined
			}
			header={
				<ComposeHeader
					collapsed={collapsed}
					onExpand={() => setCollapsed(false)}
					summary={composeHeaderSummary({
						to: toAddresses,
						cc: ccAddresses,
						bcc: bccAddresses,
						subject: subjectValue,
					})}
					from={<FromRow email="alice@northwind.example" />}
					to={
						<ComposeAddressField
							label="To"
							addresses={toAddresses}
							onChange={editAddresses(setToAddresses)}
							placeholder="Recipients"
						/>
					}
					cc={
						showCc ? (
							<ComposeAddressField
								label="Cc"
								addresses={ccAddresses}
								onChange={editAddresses(setCcAddresses)}
							/>
						) : undefined
					}
					bcc={
						showBcc ? (
							<ComposeAddressField
								label="Bcc"
								addresses={bccAddresses}
								onChange={editAddresses(setBccAddresses)}
							/>
						) : undefined
					}
					subject={
						<ComposeSubjectField
							value={subjectValue}
							onChange={(next) => {
								setSubjectValue(next);
								noteEdit();
							}}
						/>
					}
					onShowCc={() => setShowCc(true)}
					onShowBcc={() => setShowBcc(true)}
				/>
			}
			quoted={
				quoted ? (
					<QuotedText text={quoted} senderName={quotedSender} />
				) : undefined
			}
			actionBar={
				<ComposeActionBar
					send={sendState}
					onSend={onSend}
					onBlocked={onBlocked}
					onDiscard={discard}
					save={saving ? { status: "saving" } : save}
				/>
			}
		>
			{bodyLoading ? (
				<ComposeBodySkeleton />
			) : (
				<ComposeBody
					mode={bodyMode}
					onModeChange={setBodyMode}
					initialHtml={body}
					initialText={plainBody}
					onChange={noteBodyChange}
					onSubmit={sendState.status === "ready" ? onSend : undefined}
					onConversionError={setConversionFailure}
					languages={ACCOUNT_LANGUAGES}
					onLanguageChange={noteLanguageChange}
					spellcheck={composeSpellcheck}
				/>
			)}
		</ComposeFormShell>
	);
};

/**
 * Nothing typed yet. The writing surface holds its placeholder, the draft has
 * not saved because there is nothing to save, and Send names what it is waiting
 * for rather than greying out.
 */
export const Blank: Story = {
	name: "A new message, nothing typed",
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<Composer
					to={[]}
					subject=""
					body=""
					plainBody=""
					send={{
						status: "blocked",
						reason: "Add a To address before sending.",
					}}
				/>
			}
		/>
	),
};

/** Full-page compose (desktop). The action bar stays pinned, never clipped. */
export const Full: Story = {
	render: () => (
		<MailShell {...mailbox} reading={<Composer save={{ status: "saved" }} />} />
	),
};

/**
 * Spellcheck in the composer, over the surface the app assembles rather than
 * the editor on its own. The checker follows the language: English is the one
 * language this build carries words for, so the marks are ours and the browser
 * stops checking; picking Dutch from the chip finds no dictionary, and the
 * browser is checking again before the writer has typed anything.
 *
 * The word list is the placeholder (#707), so what comes back misspelt here is
 * not what a real dictionary would return.
 */
export const Spellcheck: Story = {
	name: "Spellcheck follows the message language",
	render: () => (
		<MailShell
			{...mailbox}
			reading={<Composer body={MISSPELT_DRAFT} save={{ status: "saved" }} />}
		/>
	),
	play: async ({ canvasElement }) => {
		const editable = writingSurface(canvasElement);

		await waitFor(
			async () => {
				await expect(spellMarks(editable).length).toBeGreaterThan(0);
				await expect(editable).toHaveAttribute("spellcheck", "false");
			},
			{ timeout: 5000 },
		);

		const chip = canvasElement.querySelector<HTMLElement>(
			"[data-testid=compose-language-chip]",
		);
		if (!chip) throw new Error("the language chip is not mounted");
		await userEvent.click(chip);
		const dutch = await waitFor(() => {
			const row = canvasElement.querySelector<HTMLElement>(
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

/**
 * Compose from an open message (#703). The reading pane holds one thing, so
 * Compose closes the conversation and takes the pane on the press.
 *
 * Typing in search afterwards is the step that matters: that is what used to
 * make a queued surface appear, so the surface has to be there before it and
 * unchanged after it.
 */
export const OverAnOpenMessage: Story = {
	render: function OverAnOpenMessageRender() {
		const [openThreadId, setOpenThreadId] = useState<string | undefined>(
			allThreads[0]?.id,
		);
		const [composing, setComposing] = useState(false);
		return (
			<MailShell
				{...mailbox}
				thread={openThreadId ? q3Thread : undefined}
				selectedThreadId={openThreadId}
				intelligence={q3Intelligence}
				onSelectThread={(id) => {
					setComposing(false);
					setOpenThreadId(id);
				}}
				onCompose={() => {
					setComposing(true);
					setOpenThreadId(undefined);
				}}
				reading={
					composing ? (
						<Composer to={[]} subject="" body="" plainBody="" />
					) : undefined
				}
			/>
		);
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// The reading pane's own subject heading, not the list row that carries the
		// same subject.
		const openConversation = () =>
			canvas.queryByRole("heading", { level: 2, name: q3Thread.subject });
		await expect(openConversation()).toBeVisible();

		await userEvent.click(canvas.getByRole("button", { name: /^Compose/ }));

		const recipients = canvas.getByLabelText("To:");
		await expect(recipients).toBeVisible();
		await expect(openConversation()).toBeNull();

		await userEvent.type(recipients, "ada@example.com");
		await expect(recipients).toHaveValue("ada@example.com");

		const search = canvas.getByLabelText("Search mail");
		await userEvent.type(search, "invoice");

		// Nothing about the surface moved on the search: no second copy arriving
		// late, no conversation coming back, and the recipient still held. The
		// caret is in the field being typed into, which is search. Leaving the
		// address field is what commits it, so the recipient is a tag by now
		// rather than text in the input — and a tag only survives a surface that
		// was never torn down, since a fresh one starts with none.
		await expect(search).toHaveFocus();
		await expect(canvas.getAllByLabelText("To:")).toHaveLength(1);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Remove ada@example.com" }),
			).toBeVisible(),
		);
		await expect(canvas.getByLabelText("To:")).toHaveValue("");
		await expect(openConversation()).toBeNull();
	},
};

/**
 * Inline reply within the reading pane — the same form, as a block of the page
 * rather than a window on it. It is as tall as what has been written in it and
 * has no scroller of its own; the frame around it is the one that scrolls. Its
 * subject is the form, so it is shown on its own rather than in the shell.
 */
export const Inline: Story = {
	render: () => (
		<div className="mx-auto mt-8 h-[460px] w-[640px] overflow-auto rounded-md border border-line">
			<Composer
				layout="flow"
				subject="Re: Lunch Thursday?"
				body="<p>Sounds good. See you at 12:30.</p>"
				quoted="Are we still on for Thursday? I can do 12:30."
				quotedSender="Ada Lovelace"
			/>
		</div>
	),
};

/**
 * A forward, and what it carries. The block under the editor is the message
 * being passed on — the header naming who wrote it, when, about what and to
 * whom, and then the original whole rather than quoted. It is one value with
 * what the send writes into the body, so what is shown here is what the
 * recipient reads (#845.5).
 */
export const Forward: Story = {
	render: () => (
		<div className="mx-auto mt-8 h-[460px] w-[640px] overflow-auto rounded-md border border-line">
			<Composer
				layout="flow"
				to={[]}
				subject="Fwd: Lunch Thursday?"
				body="<p>Passing this on — can you make it?</p>"
				quoted={[
					"---------- Forwarded message ----------",
					"From: Ada Lovelace <ada@example.com>",
					"Date: Jun 24, 2026, 9:14 AM",
					"Subject: Lunch Thursday?",
					"To: Me <me@example.com>",
					"",
					"Are we still on for Thursday? I can do 12:30.",
				].join("\n")}
				quotedSender="Ada Lovelace"
			/>
		</div>
	),
};

/**
 * The conversation and the reply it is being written into, arranged the way
 * `ConversationView` arranges them: the subject heading is the pane's own, the
 * reply leads the pane, the thread reads newest first underneath it, and the
 * one scrolling region holds both.
 */
const ConversationWithReply = ({
	subject,
	messages,
	draft = "",
}: {
	subject: string;
	messages: ThreadMessageData[];
	/** What has been written into the reply so far. */
	draft?: string;
}) => (
	<article className="flex h-full flex-col bg-canvas">
		<header className="border-b border-line px-5 pt-5 pb-3">
			<h1 className="max-w-2xl text-lg font-semibold leading-snug text-fg">
				{subject}
			</h1>
			<p className="mt-1 text-2xs text-fg-subtle">
				{messages.length} {messages.length === 1 ? "message" : "messages"}
			</p>
		</header>
		<div className="min-h-0 flex-1 overflow-auto" data-pane-scroll>
			{/* Same frame as `ConversationCompose` — no height of its own, so the
			    pane keeps the one scrollbar it had before the reply opened. */}
			<div className="border-b border-line bg-canvas">
				<Composer
					layout="flow"
					subject={`Re: ${subject}`}
					body={draft}
					quoted={messages[messages.length - 1]?.snippet}
					quotedSender={messages[messages.length - 1]?.fromName}
				/>
			</div>
			{[...messages].reverse().map((message) => (
				<ExpandedMessage key={message.id} message={message} />
			))}
		</div>
	</article>
);

const shortMessage: ThreadMessageData = {
	id: "msg_lunch",
	fromName: "Ada Lovelace",
	fromEmail: "ada@example.com",
	toLabel: "you",
	dateLabel: "Today 11:04",
	snippet: "Are we still on for Thursday? I can do 12:30.",
	bodyHtml: "<p>Are we still on for Thursday? I can do 12:30.</p>",
	expanded: true,
};

const longMessage: ThreadMessageData = {
	...q3Thread.messages[q3Thread.messages.length - 1],
	bodyHtml: `${q3Thread.messages[q3Thread.messages.length - 1]?.bodyHtml ?? ""}
<p>Longer context, so the pane has more message than it has room for:</p>
${Array.from(
	{ length: 14 },
	(_, index) =>
		`<p>Point ${index + 1}. The billing migration touches the export path, the dunning schedule and the invoice numbering, and each of those has a different owner today. Naming the owner per surface is what Thursday is for.</p>`,
).join("\n")}
<p>Thanks,<br/>Priya</p>`,
};

/**
 * The reply over a short message: it leads the pane, and the message it answers
 * follows it directly, with no band of empty canvas between the two.
 */
export const InlineOverAMessage: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<ConversationWithReply
					subject="Lunch Thursday?"
					messages={[shortMessage]}
				/>
			}
		/>
	),
};

/**
 * The same reply over a message several screens long. Writing does not move:
 * the composer is at the head of the pane whatever the thread under it is, and
 * grows downward as it is written into rather than scrolling inside a box of
 * its own.
 */
export const InlineOverALongMessage: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<ConversationWithReply
					subject={q3Thread.subject}
					messages={[longMessage]}
				/>
			}
		/>
	),
};

/**
 * A thread of several turns, read newest first: the reply is at the top, the
 * turn it answers is directly under it, and the ones that led there run back in
 * time below. One scrollbar covers the lot.
 */
export const InlineOverAThread: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<ConversationWithReply
					subject={q3Thread.subject}
					messages={q3Thread.messages}
				/>
			}
		/>
	),
};

/**
 * A reply several screens long, on a phone-sized pane. The composer takes the
 * height of what is written in it, so Send — the last thing in the surface —
 * would leave the screen with the text. It rides the bottom edge of the pane
 * instead, and lands back in the column when the end of the reply comes into
 * view. Nothing about the growing or the single scrollbar changes.
 */
export const InlineWithALongDraft: Story = {
	name: "Mobile — a long reply keeps Send in reach",
	render: () => (
		<div className="mx-auto mt-8 h-[844px] w-[390px] overflow-hidden rounded-md border border-line bg-canvas">
			<ConversationWithReply
				subject="Lunch Thursday?"
				messages={[shortMessage]}
				draft={LONG_DRAFT}
			/>
		</div>
	),
	play: async ({ canvasElement }) => {
		const pane = canvasElement.querySelector<HTMLElement>("[data-pane-scroll]");
		if (!pane) throw new Error("the pane is not mounted");

		// The premise: this draft really is taller than the pane. On a composer
		// that fits, Send is on screen whatever the bar does.
		await waitFor(async () => {
			const written = writingSurface(canvasElement).getBoundingClientRect();
			await expect(written.height).toBeGreaterThan(
				pane.getBoundingClientRect().height,
			);
		});

		const send = within(canvasElement).getByRole("button", { name: "Send" });
		const button = send.getBoundingClientRect();
		const visible = pane.getBoundingClientRect();
		await expect(button.top).toBeGreaterThanOrEqual(visible.top);
		await expect(button.bottom).toBeLessThanOrEqual(visible.bottom);
	},
};

/**
 * Mobile compose sheet (390): a sheet over the single pane, sent from within
 * the viewport. The list it covers is still the list the user came from.
 */
export const MobileComposeSheet: Story = {
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			{...mailbox}
			width={PHONE_WIDTH}
			overlay={
				<>
					<div className="absolute inset-0 z-40 bg-black/40" />
					<div className="absolute inset-x-0 bottom-0 z-50 h-[95%] overflow-hidden rounded-t-lg bg-canvas">
						<Composer save={{ status: "saving" }} />
					</div>
				</>
			}
		/>
	),
};

/**
 * Plain text: the formatting buttons leave, a monospace textarea takes the
 * editor's place, and what is on screen is exactly what the recipient gets.
 */
export const PlainText: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={<Composer mode="plain" save={{ status: "saved" }} />}
		/>
	),
};

/**
 * The autosave failed. The status says so where "Draft saved" would be, and
 * the banner the app raises alongside it carries the detail (#682).
 */
export const SaveFailed: Story = {
	render: () => (
		<MailShell {...mailbox} reading={<Composer save={{ status: "error" }} />} />
	),
};

/** Mid-send: the button reports it and refuses a second press. */
export const Sending: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<Composer send={{ status: "sending" }} save={{ status: "saved" }} />
			}
		/>
	),
};

/**
 * The body's chunk has not arrived yet. The header, the banner and the action
 * bar are already live around it.
 */
export const BodyLoading: Story = {
	name: "The body is still loading",
	render: () => <MailShell {...mailbox} reading={<Composer bodyLoading />} />,
};

/**
 * The keyboard is up on a phone. The header gives its rows to the writing
 * surface and keeps one line — and that line is the way back to them.
 *
 * Once they are back they stay back. The rows used to close again the moment
 * the keyboard came up over them, which is exactly when a recipient is being
 * typed: the field went away mid-word, took the keyboard with it, and came
 * back to start the loop over.
 */
export const MobileKeyboardUp: Story = {
	name: "Mobile — keyboard up, header collapsed",
	parameters: phoneParams,
	decorators: [phoneFrame],
	render: () => (
		<MailShell
			{...mailbox}
			width={PHONE_WIDTH}
			overlay={
				<>
					<div className="absolute inset-0 z-40 bg-black/40" />
					<div className="absolute inset-x-0 bottom-0 z-50 h-[60%] overflow-hidden rounded-t-lg bg-canvas">
						<Composer collapsedHeader save={{ status: "saved" }} />
					</div>
				</>
			}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Show recipients and subject" }),
		);

		const recipients = canvas.getByLabelText("To:");
		await expect(recipients).toBeVisible();

		await userEvent.type(recipients, "grace@example.com");
		await expect(canvas.getByLabelText("To:")).toHaveValue("grace@example.com");
		await expect(
			canvas.queryByRole("button", { name: "Show recipients and subject" }),
		).toBeNull();
	},
};

/**
 * SMTP not configured: Send is not greyed out. It stays pressable and says why
 * nothing left, in the words the banner above it already used.
 */
export const SendUnavailable: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<Composer
					smtpMissing
					send={{ status: "blocked", reason: SMTP_MISSING_MESSAGE }}
				/>
			}
		/>
	),
};

/**
 * Send explains rather than dies. Pressing it with no SMTP server reports the
 * reason the banner above it already gives, and sends nothing — a dead grey
 * button leaves the user guessing.
 */
export const SendExplainsItself: StoryObj<typeof Composer> = {
	args: {
		smtpMissing: true,
		send: { status: "blocked", reason: SMTP_MISSING_MESSAGE },
		onBlocked: fn(),
		onSend: fn(),
	},
	render: (args) => (
		<div className="h-[560px] w-[560px] border border-line bg-canvas">
			<Composer {...args} />
		</div>
	),
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByTestId("compose-smtp-missing-banner"),
		).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(args.onBlocked).toHaveBeenCalledWith(SMTP_MISSING_MESSAGE);
		await expect(args.onSend).not.toHaveBeenCalled();
	},
};

/**
 * A message with nobody to send it to. The refusal names the missing thing
 * rather than producing nothing at all.
 */
export const SendWithNoRecipient: StoryObj<typeof Composer> = {
	name: "Send with nobody to send it to",
	args: {
		to: [],
		send: { status: "blocked", reason: "Add a To address before sending." },
		onBlocked: fn(),
		onSend: fn(),
	},
	render: (args) => (
		<div className="h-[560px] w-[560px] border border-line bg-canvas">
			<Composer {...args} />
		</div>
	),
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(args.onBlocked).toHaveBeenCalledWith(
			"Add a To address before sending.",
		);
		await expect(args.onSend).not.toHaveBeenCalled();
	},
};

/**
 * The message being forwarded is attachments and nothing else. The composer
 * sends a text body and an html body and no attachments, so this forward would
 * arrive holding only what was typed into it — Send says so and sends nothing,
 * rather than leaving with none of the original in it (#1030).
 */
export const NothingToForward: StoryObj<typeof Composer> = {
	name: "Forwarding a message with no body to quote",
	args: {
		subject: "Fwd: Scans",
		to: [],
		quoteMissing: "forward",
		send: {
			status: "blocked",
			reason: NO_QUOTABLE_BODY_FORWARD_MESSAGE,
		},
		onBlocked: fn(),
		onSend: fn(),
	},
	render: (args) => (
		<div className="h-[560px] w-[560px] border border-line bg-canvas">
			<Composer {...args} />
		</div>
	),
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId("compose-quote-missing")).toBeVisible();
		await userEvent.click(canvas.getByRole("button", { name: "Send" }));
		await expect(args.onBlocked).toHaveBeenCalledWith(
			NO_QUOTABLE_BODY_FORWARD_MESSAGE,
		);
		await expect(args.onSend).not.toHaveBeenCalled();
	},
};

/**
 * The same message, answered rather than passed on. A reply carries the answer
 * and the thread it belongs to whether or not the original can be quoted, so it
 * sends — and says the original is not in it.
 */
export const ReplyWithNothingToQuote: Story = {
	name: "Replying to a message with no body to quote",
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<Composer
					subject="Re: Scans"
					quoteMissing="reply"
					save={{ status: "saved" }}
				/>
			}
		/>
	),
};
