import {
	type AddressEntry,
	Banner,
	ComposeActionBar,
	ComposeAddressField,
	ComposeBodySkeleton,
	ComposeFormShell,
	ComposeHeader,
	type ComposeSaveStatus,
	type ComposeSendState,
	ComposeSmtpMissingBanner,
	ComposeSubjectField,
	composeHeaderSummary,
	ExpandedMessage,
	inboxFilterConfig,
	QuotedText,
	type RichTextValue,
	SMTP_MISSING_MESSAGE,
	type ThreadMessageData,
} from "@remit/ui";
import {
	ComposeBody,
	type ComposeBodyMode,
	type ConversionFailure,
} from "@remit/ui/rich-text";
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

const DEFAULT_PLAIN_BODY = [
	"Thanks — that works for me.",
	"",
	"| Region | Total |",
	"| --- | --- |",
	"| EMEA | 412 |",
].join("\n");

const ACCOUNT_LANGUAGES = ["en", "nl", "de"];

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
	saveStatus?: ComposeSaveStatus;
	send?: ComposeSendState;
	onBlocked?: (reason: string) => void;
	onSend?: () => void;
	smtpMissing?: boolean;
	quoted?: string;
	quotedSender?: string;
	/** Renders the skeleton the app shows while the body's chunk loads. */
	bodyLoading?: boolean;
	collapsedHeader?: boolean;
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
	saveStatus = "idle",
	send,
	onBlocked = () => undefined,
	onSend = () => undefined,
	smtpMissing = false,
	quoted,
	quotedSender,
	bodyLoading = false,
	collapsedHeader = false,
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
			? { status: "blocked", reason: "Add at least one recipient." }
			: { status: "ready" });

	return (
		<ComposeFormShell
			banner={
				smtpMissing || conversionFailure ? (
					<>
						{smtpMissing && (
							<ComposeSmtpMissingBanner onConfigure={configureSmtp} />
						)}
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
					saveStatus={saving ? "saving" : saveStatus}
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
					send={{ status: "blocked", reason: "Add at least one recipient." }}
				/>
			}
		/>
	),
};

/** Full-page compose (desktop). The action bar stays pinned, never clipped. */
export const Full: Story = {
	render: () => (
		<MailShell {...mailbox} reading={<Composer saveStatus="saved" />} />
	),
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
 * Inline reply within the reading pane — the same form under the conversation
 * it answers, in a compact frame. Its subject is the form, so it is shown on
 * its own rather than in the shell.
 */
export const Inline: Story = {
	render: () => (
		<div className="mx-auto mt-8 h-[460px] w-[640px] overflow-hidden rounded-md border border-line">
			<Composer
				subject="Re: Lunch Thursday?"
				body="<p>Sounds good. See you at 12:30.</p>"
				quoted="Are we still on for Thursday? I can do 12:30."
				quotedSender="Ada Lovelace"
			/>
		</div>
	),
};

/**
 * The conversation and the reply it is being written into, arranged the way
 * `ConversationView` arranges them: the subject heading is the pane's own, the
 * message and the reply share one scrolling region, and the reply's frame is
 * the one `InlineCompose` gives it.
 */
const ConversationWithReply = ({
	subject,
	messages,
}: {
	subject: string;
	messages: ThreadMessageData[];
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
		<div className="min-h-0 flex-1 overflow-auto">
			{messages.map((message) => (
				<ExpandedMessage key={message.id} message={message} />
			))}
			{/* Same frame as `InlineCompose` — the reply takes a height on a
			    desktop pane rather than whatever the message leaves over. */}
			<div className="flex flex-col border-t border-line bg-canvas max-h-[min(400px,60dvh)] lg:h-[min(560px,55dvh)] lg:max-h-none">
				<Composer
					subject={`Re: ${subject}`}
					body=""
					quoted={messages[messages.length - 1]?.snippet}
					quotedSender={messages[messages.length - 1]?.fromName}
				/>
			</div>
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
 * The reply under a short message: it follows the body directly, with no band
 * of empty canvas between the two.
 */
export const InlineUnderAMessage: Story = {
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
 * The same reply under a message several screens long — the case that used to
 * be unusable. The reply scrolls with the conversation, so it is reachable, and
 * it keeps its own height instead of being squeezed to a couple of lines by
 * whatever the message left over.
 */
export const InlineUnderALongMessage: Story = {
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
						<Composer saveStatus="saving" />
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
			reading={<Composer mode="plain" saveStatus="saved" />}
		/>
	),
};

/**
 * The autosave failed. The status says so where "Draft saved" would be, and
 * the banner the app raises alongside it carries the detail (#682).
 */
export const SaveFailed: Story = {
	render: () => (
		<MailShell {...mailbox} reading={<Composer saveStatus="error" />} />
	),
};

/** Mid-send: the button reports it and refuses a second press. */
export const Sending: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={<Composer send={{ status: "sending" }} saveStatus="saved" />}
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
						<Composer collapsedHeader saveStatus="saved" />
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
		send: { status: "blocked", reason: "Add at least one recipient." },
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
			"Add at least one recipient.",
		);
		await expect(args.onSend).not.toHaveBeenCalled();
	},
};
