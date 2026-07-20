import { Button } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Loader2, Paperclip, Send, Trash2 } from "lucide-react";

/**
 * Design source for the compose surface (#788). The live `ComposeForm` +
 * `ComposeActionBar` are heavily wired (react-query mutations, Plate editor);
 * these stories render the presentational shell at the three geometries it
 * ships in. The desktop Send button was reported clipped off the bottom of the
 * form — the Full story keeps the action bar pinned in view so a baseline
 * catches a regression.
 */

const meta: Meta = {
	title: "Flows/Compose",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

type SaveStatus = "idle" | "saving" | "saved" | "error";

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

function ComposeShell({
	to = "ada@example.com",
	subject = "Re: Q3 planning",
	body = "Thanks — that works for me. I'll send the deck tomorrow.",
	actionBar,
}: {
	to?: string;
	subject?: string;
	body?: string;
	actionBar: React.ReactNode;
}) {
	return (
		<div className="flex h-full w-full flex-col bg-surface">
			<Field label="To" value={to} />
			<Field label="Subject" value={subject} />
			<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-md leading-relaxed text-fg">
				{body}
			</div>
			{actionBar}
		</div>
	);
}

/** Full-page compose (desktop). The action bar stays pinned, never clipped. */
export const Full: Story = {
	render: () => (
		<div className="h-dvh">
			<ComposeShell actionBar={<ActionBar saveStatus="saved" />} />
		</div>
	),
};

/** Inline reply within the reading pane — same form, compact frame. */
export const Inline: Story = {
	render: () => (
		<div className="mx-auto mt-8 h-[420px] w-[640px] overflow-hidden rounded-md border border-line">
			<ComposeShell
				subject="Re: Lunch Thursday?"
				body="Sounds good. See you at 12:30."
				actionBar={<ActionBar saveStatus="idle" />}
			/>
		</div>
	),
};

/** Mobile compose sheet (390). Full-screen, send within the viewport. */
export const MobileComposeSheet: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => (
		<div className="h-dvh">
			<ComposeShell actionBar={<ActionBar saveStatus="saving" />} />
		</div>
	),
};

/** SMTP not configured: Send no-ops and explains, never a dead grey button. */
export const SendUnavailable: Story = {
	render: () => (
		<div className="h-dvh">
			<ComposeShell
				actionBar={
					<ActionBar
						canSend={false}
						disabledReason="Add an SMTP server to this account to send"
					/>
				}
			/>
		</div>
	),
};
