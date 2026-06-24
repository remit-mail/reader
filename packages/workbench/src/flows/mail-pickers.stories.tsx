import { Button } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Archive,
	FolderInput,
	Inbox,
	MailOpen,
	Search,
	Send,
	Trash2,
	X,
} from "lucide-react";

/**
 * Design source for the bulk-triage and folder-picker surfaces (#788): the
 * desktop `SelectionToolbar`, the mobile `SelectionTopBar` (with the
 * cross-account move guard), the move-to-mailbox picker, and the
 * reclassify-sender dialog. Presentational shells mirroring the live wiring.
 */

const meta: Meta = {
	title: "Flows/MailPickers",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

function SelectionToolbar({
	count,
	moveDisabledHint,
}: {
	count: number;
	moveDisabledHint?: string;
}) {
	return (
		<div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface-sunken px-3 py-2">
			<div className="flex items-center gap-3">
				<button
					type="button"
					aria-label="Clear selection"
					className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-surface-raised"
				>
					<X className="size-4 text-fg-muted" />
				</button>
				<span className="text-sm font-medium text-fg">
					{count} {count === 1 ? "message" : "messages"} selected
				</span>
				{moveDisabledHint && (
					<span className="text-xs text-fg-muted">{moveDisabledHint}</span>
				)}
			</div>
			<div className="flex items-center gap-1">
				<button
					type="button"
					aria-label="Mark as read"
					className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-surface-raised"
				>
					<MailOpen className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Move selected messages"
					className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-surface-raised"
				>
					<FolderInput className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Delete selected messages"
					className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded bg-danger px-3 text-sm font-medium text-canvas hover:bg-danger/90"
				>
					<Trash2 className="size-4" />
					<span className="hidden sm:inline">Delete</span>
				</button>
			</div>
		</div>
	);
}

/** Desktop bulk-triage bar over a selected list. */
export const SelectionDesktop: Story = {
	render: () => (
		<div className="w-full">
			<SelectionToolbar count={3} />
		</div>
	),
};

/** Cross-account selection: Move is guarded with an inline reason, never a dead button. */
export const SelectionCrossAccount: Story = {
	render: () => (
		<div className="w-full">
			<SelectionToolbar
				count={5}
				moveDisabledHint="Move works within one account — narrow the selection"
			/>
		</div>
	),
};

/** Mobile multi-select top bar with the move guard surfaced below the row. */
export const SelectionMobile: Story = {
	parameters: { viewport: { defaultViewport: "mobile1" } },
	render: () => (
		<div className="sticky top-0 z-10 flex flex-col gap-1 border-b border-line bg-surface-sunken/50 px-3 py-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<button
						type="button"
						aria-label="Cancel selection"
						className="inline-flex min-h-11 min-w-11 items-center justify-center rounded"
					>
						<X className="size-4 text-fg-muted" />
					</button>
					<span className="text-sm font-medium text-fg">
						4 messages selected
					</span>
				</div>
				<div className="flex items-center gap-1 text-fg-muted">
					<MailOpen className="size-4" />
					<FolderInput className="size-4" />
					<Trash2 className="size-4 text-danger" />
				</div>
			</div>
			<p className="text-xs text-fg-muted">
				Move works within one account — narrow the selection
			</p>
		</div>
	),
};

/** Move-to-mailbox picker: search + the destination folder list. */
export const MovePicker: Story = {
	render: () => (
		<div className="mx-auto mt-12 w-72 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
			<div className="flex items-center gap-2 border-b border-line px-3 py-2">
				<Search className="size-4 text-fg-subtle" />
				<input
					placeholder="Move to…"
					className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
				/>
			</div>
			<div className="max-h-64 overflow-y-auto py-1">
				{[
					{ icon: <Inbox className="size-4" />, label: "Inbox" },
					{ icon: <Archive className="size-4" />, label: "Archive" },
					{ icon: <Send className="size-4" />, label: "Sent" },
					{ icon: <Trash2 className="size-4" />, label: "Trash" },
					{ icon: <FolderInput className="size-4" />, label: "Receipts" },
				].map((row) => (
					<button
						key={row.label}
						type="button"
						className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-fg hover:bg-surface-sunken"
					>
						<span className="text-fg-subtle">{row.icon}</span>
						{row.label}
					</button>
				))}
			</div>
		</div>
	),
};

const CATEGORIES = [
	"personal",
	"newsletter",
	"marketing",
	"automated",
	"transactional",
	"social",
];

/** Reclassify-sender dialog from the intelligence pane. */
export const ReclassifyDialog: Story = {
	render: () => (
		<div className="relative flex h-dvh w-full items-center justify-center">
			<div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" />
			<div className="relative z-10 w-full max-w-sm rounded-sm border border-line bg-surface p-6 shadow-lg">
				<h2 className="text-lg font-semibold text-fg">
					Reclassify this sender
				</h2>
				<p className="mt-2 text-sm text-fg-muted">
					Set a category override for future messages from this sender.
				</p>
				<div className="mt-4 flex flex-col gap-1">
					{CATEGORIES.map((cat) => (
						<button
							key={cat}
							type="button"
							className={`flex min-h-11 items-center justify-between rounded px-3 text-left text-sm capitalize hover:bg-surface-raised ${
								cat === "newsletter" ? "font-semibold text-accent" : "text-fg"
							}`}
						>
							{cat}
							{cat === "newsletter" && (
								<span className="text-2xs text-fg-subtle">current</span>
							)}
						</button>
					))}
				</div>
				<div className="mt-6 flex justify-end">
					<Button variant="secondary" size="md">
						Cancel
					</Button>
				</div>
			</div>
		</div>
	),
};
