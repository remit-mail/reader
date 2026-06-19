import { type OutboxStatus, OutboxStatusBadge } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox, RotateCcw, Send, Trash2 } from "lucide-react";

/**
 * Design source for the outbox (#788): the status-tinted message list (queued /
 * sending / sent / failed / blocked), row actions on the unsendable states, and
 * the empty zero-state. Mirrors `routes/mail/outbox.tsx`; the status badge is
 * the shared remit-ui `OutboxStatusBadge`.
 */

const meta: Meta = {
	title: "Flows/Outbox",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

interface Row {
	status: OutboxStatus;
	to: string;
	subject: string;
	when: string;
	error?: string;
}

const rowTint: Partial<Record<OutboxStatus, string>> = {
	failed: "bg-danger-soft",
	blocked: "bg-warning/10",
};

function OutboxRow({ row }: { row: Row }) {
	const showActions = row.status === "failed" || row.status === "blocked";
	return (
		<div
			className={`flex items-start gap-3 border-b border-line px-4 py-3 ${
				rowTint[row.status] ?? ""
			}`}
		>
			<OutboxStatusBadge status={row.status} iconOnly className="mt-0.5" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center justify-between gap-2">
					<span className="truncate text-sm font-medium text-fg">{row.to}</span>
					<span className="shrink-0 text-xs text-fg-muted">{row.when}</span>
				</div>
				<div className="truncate text-sm text-fg">{row.subject}</div>
				<div className="mt-1 flex items-center gap-2">
					<OutboxStatusBadge status={row.status} />
					{row.error && (
						<span className="truncate text-xs text-fg-muted">
							— {row.error}
						</span>
					)}
				</div>
			</div>
			{showActions && (
				<div className="flex shrink-0 items-center gap-1 text-fg-muted">
					{row.status === "failed" && (
						<button type="button" className="rounded-md p-1.5" title="Retry">
							<RotateCcw className="size-3.5" />
						</button>
					)}
					<button
						type="button"
						className="rounded-md p-1.5"
						title="Edit as draft"
					>
						<Send className="size-3.5" />
					</button>
					<button type="button" className="rounded-md p-1.5" title="Delete">
						<Trash2 className="size-3.5" />
					</button>
				</div>
			)}
		</div>
	);
}

function OutboxList({ rows }: { rows: Row[] }) {
	return (
		<div className="flex h-dvh w-full flex-col bg-surface">
			<header className="flex h-pane-header shrink-0 items-center border-b border-line px-row-inset">
				<h1 className="text-sm font-semibold text-fg">Outbox</h1>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{rows.map((row) => (
					<OutboxRow key={`${row.status}-${row.subject}`} row={row} />
				))}
			</div>
		</div>
	);
}

/** One row per status, including the unsendable states with row actions. */
export const AllStatuses: Story = {
	render: () => (
		<OutboxList
			rows={[
				{
					status: "queued",
					to: "ada@example.com",
					subject: "Re: Q3 planning",
					when: "2:14 PM",
				},
				{
					status: "sending",
					to: "team@example.com",
					subject: "Weekly update",
					when: "2:13 PM",
				},
				{
					status: "sent",
					to: "grace@example.com",
					subject: "Invoice #1042",
					when: "1:58 PM",
				},
				{
					status: "failed",
					to: "linus@example.com",
					subject: "Design review notes",
					when: "1:40 PM",
					error: "SMTP connection timed out",
				},
				{
					status: "blocked",
					to: "ken@example.com",
					subject: "Re: contract",
					when: "Yesterday",
					error: "No SMTP server configured for this account",
				},
			]}
		/>
	),
};

/** Empty outbox. */
export const Empty: Story = {
	render: () => (
		<div className="flex h-dvh w-full flex-col items-center justify-center bg-surface text-center">
			<Inbox className="size-10 text-fg-subtle" />
			<p className="mt-3 text-sm text-fg-muted">No outbox messages</p>
		</div>
	),
};
