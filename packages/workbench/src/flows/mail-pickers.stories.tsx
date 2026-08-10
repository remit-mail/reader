import { Button, DialogBackdrop, inboxFilterConfig } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Archive,
	FolderInput,
	Inbox,
	Search,
	Send,
	Trash2,
} from "lucide-react";
import { allThreads, q3Intelligence, q3Thread } from "../fixtures/workspace.js";
import { MailShell } from "../screens/mail-shell.js";

/**
 * Design source for the folder-picker surfaces (#788): the move-to-mailbox
 * picker and the reclassify-sender dialog. The bulk-triage selection bars
 * used to live here as hand-rolled `<div>`/`<button>` mockups; they drifted
 * from the real components (no busy spinner, no Organize action, bare div
 * icons instead of real `Button`s) and are superseded by
 * `selection-top-bar.stories.tsx`, which renders the actual `SelectionTopBar`
 * kit component including its full prop surface (busy, cross-account hint,
 * select-all, counting, bulk-progress, partial-failure).
 */

const meta: Meta = {
	title: "Flows/MailPickers",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * Move-to-mailbox picker: search + the destination folder list. A popover that
 * hangs off whichever Move it was opened from, so it is shown on its own rather
 * than floating unanchored in a shell.
 */
export const MovePicker: Story = {
	parameters: { layout: "centered" },
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

/**
 * Reclassify-sender dialog, opened from the intelligence pane it overrides a
 * category in. The backdrop is translucent, so the screen behind it is part of
 * what this story shows.
 */
export const ReclassifyDialog: Story = {
	render: () => (
		<MailShell
			selectedNavId="mbx_personal_inbox"
			listTitle="Inbox"
			unreadCount={9}
			sections={[{ id: "inbox", threads: allThreads }]}
			preset={inboxFilterConfig()}
			thread={q3Thread}
			selectedThreadId="thr_q3"
			intelligence={q3Intelligence}
			overlay={<ReclassifyOverlay />}
		/>
	),
};

function ReclassifyOverlay() {
	return (
		<div className="absolute inset-0 z-50 flex items-center justify-center">
			<DialogBackdrop
				label="Dismiss reclassify sender"
				onDismiss={() => undefined}
				className="backdrop-blur-sm"
			/>
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
	);
}
