import {
	type AddressEntry,
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
	inboxFilterConfig,
	QuotedText,
	SMTP_MISSING_MESSAGE,
} from "@remit/ui";
import { ComposeBody, type ComposeBodyMode } from "@remit/ui/rich-text";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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

const Composer = ({
	to = [{ email: "ada@example.com", displayName: "Ada Lovelace" }],
	subject = "Re: Q3 planning",
	body = DEFAULT_BODY,
	plainBody = DEFAULT_PLAIN_BODY,
	mode = "rich",
	saveStatus = "idle",
	send = { status: "ready" },
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

	return (
		<ComposeFormShell
			banner={
				smtpMissing ? (
					<ComposeSmtpMissingBanner onConfigure={() => undefined} />
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
							onChange={setToAddresses}
							placeholder="Recipients"
						/>
					}
					cc={
						showCc ? (
							<ComposeAddressField
								label="Cc"
								addresses={ccAddresses}
								onChange={setCcAddresses}
							/>
						) : undefined
					}
					bcc={
						showBcc ? (
							<ComposeAddressField
								label="Bcc"
								addresses={bccAddresses}
								onChange={setBccAddresses}
							/>
						) : undefined
					}
					subject={
						<ComposeSubjectField
							value={subjectValue}
							onChange={setSubjectValue}
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
					send={send}
					onSend={onSend}
					onBlocked={onBlocked}
					onDiscard={() => undefined}
					saveStatus={saveStatus}
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
					onChange={() => undefined}
					onConversionError={() => undefined}
					languages={ACCOUNT_LANGUAGES}
					onLanguageChange={() => undefined}
				/>
			)}
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
 * Send explains rather than dies. Every refusal names itself — a message with
 * nobody to send it to used to produce nothing at all.
 */
export const SendExplainsItself: StoryObj<typeof Composer> = {
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
