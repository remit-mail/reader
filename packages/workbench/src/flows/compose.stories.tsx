import {
	type AddressEntry,
	Banner,
	ComposeActionBar,
	ComposeAddressField,
	ComposeFormShell,
	ComposeHeader,
	type ComposeSaveStatus,
	ComposeSmtpMissingBanner,
	ComposeSubjectField,
	composeHeaderSummary,
	inboxFilterConfig,
	QuotedText,
	type RichTextValue,
} from "@remit/ui";
import {
	ComposeBody,
	type ComposeBodyMode,
	type ConversionFailure,
} from "@remit/ui/rich-text";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { allThreads } from "../fixtures/workspace.js";
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
	sending?: boolean;
	canSend?: boolean;
	unavailableReason?: string;
	onUnavailable?: (reason: string) => void;
	onSend?: () => void;
	smtpMissing?: boolean;
	quoted?: string;
	quotedSender?: string;
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
	sending = false,
	canSend,
	unavailableReason,
	onUnavailable,
	onSend = () => undefined,
	smtpMissing = false,
	quoted,
	quotedSender,
}: ComposerProps) => {
	const [toAddresses, setToAddresses] = useState(to);
	const [ccAddresses, setCcAddresses] = useState<AddressEntry[]>([]);
	const [bccAddresses, setBccAddresses] = useState<AddressEntry[]>([]);
	const [showCc, setShowCc] = useState(false);
	const [showBcc, setShowBcc] = useState(false);
	const [subjectValue, setSubjectValue] = useState(subject);
	const [bodyMode, setBodyMode] = useState<ComposeBodyMode>(mode);
	const [bodyValue, setBodyValue] = useState<RichTextValue>({
		html: body,
		text: plainBody,
		formatting: [],
	});
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
		setBodyValue(value);
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

	const sendable =
		canSend ?? (toAddresses.length > 0 && bodyValue.text.trim() !== "");

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
					onSend={onSend}
					onDiscard={discard}
					sending={sending}
					canSend={sendable}
					saveStatus={saving ? "saving" : saveStatus}
					unavailableReason={unavailableReason}
					onUnavailable={onUnavailable}
				/>
			}
		>
			<ComposeBody
				mode={bodyMode}
				onModeChange={setBodyMode}
				initialHtml={body}
				initialText={plainBody}
				onChange={noteBodyChange}
				onSubmit={sendable ? onSend : undefined}
				onConversionError={setConversionFailure}
				languages={ACCOUNT_LANGUAGES}
				onLanguageChange={noteLanguageChange}
			/>
		</ComposeFormShell>
	);
};

/** Full-page compose (desktop). The action bar stays pinned, never clipped. */
export const Full: Story = {
	render: () => (
		<MailShell {...mailbox} reading={<Composer saveStatus="saved" />} />
	),
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
		<MailShell {...mailbox} reading={<Composer sending saveStatus="saved" />} />
	),
};

/**
 * SMTP not configured: Send is not greyed out. It stays pressable and says why
 * nothing left, and the banner above carries the way to fix it.
 */
export const SendUnavailable: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<Composer
					smtpMissing
					canSend={false}
					unavailableReason="Add an SMTP server to this account to send"
				/>
			}
		/>
	),
};

/**
 * Send explains rather than dies. Pressing it with no SMTP server reports the
 * reason and sends nothing — a dead grey button leaves the user guessing.
 */
export const SendExplainsItself: StoryObj<typeof Composer> = {
	args: {
		smtpMissing: true,
		canSend: false,
		unavailableReason: "Add an SMTP server to this account to send",
		onUnavailable: fn(),
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
		await expect(args.onUnavailable).toHaveBeenCalledWith(
			"Add an SMTP server to this account to send",
		);
		await expect(args.onSend).not.toHaveBeenCalled();
	},
};
