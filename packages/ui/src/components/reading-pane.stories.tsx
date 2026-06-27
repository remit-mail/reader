import type { Meta, StoryObj } from "@storybook/react";
import { Paperclip, Star } from "lucide-react";
import type { ThreadData, ThreadMessageData } from "./app-shell-types.js";
import {
	CollapsedMessage,
	ExpandedMessage,
	ReadingPane,
} from "./reading-pane.js";

const thread: ThreadData = {
	subject: "Q3 planning notes",
	messages: [
		{
			id: "msg-1",
			fromName: "Alex Rivera",
			fromEmail: "alex@example.com",
			toLabel: "you",
			dateLabel: "Yesterday, 14:02",
			snippet: "Here's where we landed after the call…",
			bodyHtml:
				"<p>Here's where we landed after the call. The roadmap stands.</p>",
		},
		{
			id: "msg-2",
			fromName: "Jamie Chen",
			fromEmail: "jamie@example.com",
			toLabel: "Alex Rivera, you",
			dateLabel: "Today, 09:11",
			snippet: "Thanks — I'll circulate the deck this afternoon.",
			bodyHtml:
				"<p>Thanks for the summary. I'll circulate the deck this afternoon and follow up with finance.</p><ul><li>Confirm headcount</li><li>Lock the budget</li></ul>",
			expanded: true,
		},
	],
};

// A designed (framed) newsletter so the Screens story exercises the REAL
// renderer — sanitized + sandboxed iframe, flush layout, #727 scale-to-fit —
// rather than a plain inline paragraph (#940). The fixed 600px table is the
// kind of markup that overflowed a phone before #727.
const newsletterThread: ThreadData = {
	subject: "Node Weekly — Issue 540",
	messages: [
		{
			id: "nl-1",
			fromName: "Node Weekly",
			fromEmail: "news@nodeweekly.example",
			toLabel: "you",
			dateLabel: "Today, 08:00",
			snippet: "Node.js 24 hits LTS, and more…",
			framed: true,
			expanded: true,
			bodyHtml: `<table width="600" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse;">
	<tr><td width="600" style="width:600px;background:#83cd29;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#ffffff;">
		<h1 style="margin:0;font-size:26px;">Node Weekly</h1>
		<p style="margin:4px 0 0;font-size:14px;">Issue 540</p>
	</td></tr>
	<tr><td width="600" style="width:600px;padding:24px;font-family:Georgia,serif;color:#1a1a1a;">
		<h2 style="font-size:18px;color:#111;">Node.js 24 hits LTS</h2>
		<p>The permission model graduated from experimental and the test runner picked up snapshot testing.</p>
		<p><a href="https://example.com/issue/540" style="color:#43853d;">Read the full issue &rarr;</a></p>
	</td></tr>
</table>`,
		},
	],
};

const meta: Meta<typeof ReadingPane> = {
	title: "Screens/Kit/ReadingPane",
	component: ReadingPane,
	parameters: { layout: "fullscreen" },
	render: (args) => (
		<div className="h-screen border border-line">
			<ReadingPane {...args} />
		</div>
	),
};
export default meta;

type Story = StoryObj<typeof ReadingPane>;

export const WithThread: Story = { args: { thread } };

/** A designed newsletter rendered through the real sanitize → sandboxed-iframe
 *  pipeline — the same rendering the live app shows (#940). */
export const Newsletter: Story = { args: { thread: newsletterThread } };

export const Empty: Story = { args: { thread: undefined } };

export const WithIntelligenceToggle: Story = {
	args: { thread, showIntelligenceToggle: true, intelligenceOpen: false },
};

/* ------------------------------------------------------------------ */
/* Row primitives — exercise the app-injection slots directly so the   */
/* kit stays the verified source of truth for the thread-row rhythm.   */
/* ------------------------------------------------------------------ */

const row: ThreadMessageData = {
	id: "row-1",
	fromName: "Jamie Chen",
	fromEmail: "jamie@example.com",
	toLabel: "Alex Rivera, you",
	dateLabel: "Today, 09:11",
	snippet: "Thanks — I'll circulate the deck this afternoon.",
	bodyHtml:
		"<p>Thanks for the summary. I'll circulate the deck this afternoon.</p>",
};

/** The collapsed row with the app's real trailing cluster (star + paperclip +
 *  date), an unread dot and a keyboard-focus ring — the slots the live
 *  MessageCard injects. */
export const CollapsedRowComposed: StoryObj<typeof CollapsedMessage> = {
	render: () => (
		<div className="max-w-3xl border border-line">
			<CollapsedMessage message={row} isUnread />
			<CollapsedMessage
				message={{ ...row, id: "row-2", fromName: "Alex Rivera" }}
				isFocused
				trailing={
					<div className="flex shrink-0 items-center gap-1">
						<button type="button" className="rounded p-0.5 text-warning">
							<Star className="size-3 fill-current" />
						</button>
						<Paperclip className="size-3 text-fg-subtle" />
						<span className="text-2xs text-fg-subtle tabular-nums">
							Today, 08:42
						</span>
					</div>
				}
			/>
		</div>
	),
};

/** The expanded row with the app's injected slots: a sender badge, an
 *  indicators row, an action-menu placeholder and a custom recipient line —
 *  proving the kit composes app interactivity without importing app code. */
export const ExpandedRowComposed: StoryObj<typeof ExpandedMessage> = {
	render: () => (
		<div className="max-w-3xl border border-line">
			<ExpandedMessage
				message={row}
				senderBadge={<span className="ml-1 text-positive text-xs">✓</span>}
				to={<>to Alex Rivera and 2 others</>}
				indicators={
					<div className="mt-0.5 flex items-center gap-1">
						<Star className="size-3.5 fill-current text-warning" />
						<Paperclip className="size-3.5 text-fg-subtle" />
					</div>
				}
				actionMenu={
					<button type="button" className="rounded p-1 text-fg-subtle">
						⋯
					</button>
				}
			/>
		</div>
	),
};
