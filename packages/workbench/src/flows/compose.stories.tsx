import { Button, inboxFilterConfig } from "@remit/ui";
import { RichTextEditor } from "@remit/ui/rich-text";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Loader2, Paperclip, Send, Trash2 } from "lucide-react";
import { allThreads } from "../fixtures/workspace.js";
import { PHONE_WIDTH, phoneFrame, phoneParams } from "../lib/story-frame.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * Design source for the compose surface (#788). The live `ComposeForm` is
 * heavily wired (react-query mutations, draft autosave); these stories render
 * the presentational shell around the real editor, at the three geometries it
 * ships in. The desktop Send button was reported clipped off the bottom of the
 * form — the Full story keeps the action bar pinned in view so a baseline
 * catches a regression.
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

type SaveStatus = "idle" | "saving" | "saved" | "error";

const mailbox = {
	selectedNavId: "mbx_personal_inbox",
	listTitle: "Inbox",
	unreadCount: 9,
	sections: [{ id: "inbox", threads: allThreads }],
	preset: inboxFilterConfig(),
};

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
	if (status === "saving")
		return <span className="animate-pulse text-xs text-fg-muted">Saving…</span>;
	if (status === "saved")
		return <span className="text-xs text-fg-muted">Draft saved</span>;
	if (status === "error")
		return <span className="text-xs text-danger">Save failed</span>;
	return null;
}

function ActionBar({
	isSending = false,
	canSend = true,
	saveStatus = "idle",
	disabledReason,
}: {
	isSending?: boolean;
	canSend?: boolean;
	saveStatus?: SaveStatus;
	disabledReason?: string;
}) {
	return (
		<div className="flex items-center justify-between border-t border-line px-3 py-2">
			<div className="flex items-center gap-3">
				<Button
					variant="primary"
					size="sm"
					icon={
						isSending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Send className="size-4" />
						)
					}
					onClick={() => undefined}
					title={disabledReason}
				>
					{isSending ? "Sending…" : "Send"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					icon={<Paperclip className="size-4" />}
					aria-label="Attach file"
				/>
				<SaveStatusIndicator status={saveStatus} />
				{!canSend && disabledReason && (
					<span className="text-xs text-fg-muted">{disabledReason}</span>
				)}
			</div>
			<Button
				variant="ghost"
				size="sm"
				icon={<Trash2 className="size-4" />}
				aria-label="Discard draft"
			/>
		</div>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
			<span className="w-12 shrink-0 text-xs text-fg-subtle">{label}</span>
			<span className="min-w-0 flex-1 truncate text-sm text-fg">{value}</span>
		</div>
	);
}

const DEFAULT_BODY =
	"<p>Thanks — that works for me. I'll send the deck tomorrow.</p>";

function ComposeShell({
	to = "ada@example.com",
	subject = "Re: Q3 planning",
	body = DEFAULT_BODY,
	actionBar,
}: {
	to?: string;
	subject?: string;
	body?: string;
	actionBar: React.ReactNode;
}) {
	return (
		<div className="flex h-full w-full min-h-0 flex-col bg-surface">
			<Field label="To" value={to} />
			<Field label="Subject" value={subject} />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<RichTextEditor initialHtml={body} />
			</div>
			{actionBar}
		</div>
	);
}

/** Full-page compose (desktop). The action bar stays pinned, never clipped. */
export const Full: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={<ComposeShell actionBar={<ActionBar saveStatus="saved" />} />}
		/>
	),
};

/**
 * Inline reply within the reading pane — the same form under the conversation
 * it answers, in a compact frame. Its subject is the form, so it is shown on
 * its own rather than in the shell.
 */
export const Inline: Story = {
	render: () => (
		<div className="mx-auto mt-8 h-[420px] w-[640px] overflow-hidden rounded-md border border-line">
			<ComposeShell
				subject="Re: Lunch Thursday?"
				body="<p>Sounds good. See you at 12:30.</p>"
				actionBar={<ActionBar saveStatus="idle" />}
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
						<ComposeShell actionBar={<ActionBar saveStatus="saving" />} />
					</div>
				</>
			}
		/>
	),
};

/** SMTP not configured: Send no-ops and explains, never a dead grey button. */
export const SendUnavailable: Story = {
	render: () => (
		<MailShell
			{...mailbox}
			reading={
				<ComposeShell
					actionBar={
						<ActionBar
							canSend={false}
							disabledReason="Add an SMTP server to this account to send"
						/>
					}
				/>
			}
		/>
	),
};
