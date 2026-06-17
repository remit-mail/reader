import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	Archive,
	ArrowLeft,
	EllipsisVertical,
	Forward,
	Info,
	Mail,
	MailOpen,
	Reply,
	ReplyAll,
	Star,
	Trash2,
} from "lucide-react";
import { useState } from "react";

/**
 * Inline recreation of MobileConversationTopBar + MobileActionBar for
 * the Storybook workbench. The live components live in remit-web-client
 * (which the workbench does not depend on), so we inline the presentational
 * layer here — the same approach used by BugReportButton.stories.tsx.
 */

const chip =
	"inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-11 text-sm font-medium rounded-full border border-line hover:bg-surface-raised transition-colors";

function TopBar({
	isStarred,
	onStar,
	onArchive,
	onDelete,
	onMoreOpen,
	moreOpen,
	intelligenceOpen,
	onIntelligence,
}: {
	isStarred: boolean;
	onStar: () => void;
	onArchive: () => void;
	onDelete: () => void;
	onMoreOpen: () => void;
	moreOpen: boolean;
	intelligenceOpen: boolean;
	onIntelligence: () => void;
}) {
	return (
		<div className="flex h-12 shrink-0 items-center justify-end gap-0.5 border-b border-line bg-canvas px-1">
			<button
				type="button"
				onClick={onStar}
				className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
				aria-label={isStarred ? "Remove flag" : "Flag"}
			>
				<Star
					className={`size-5${isStarred ? " fill-warning text-warning" : ""}`}
				/>
			</button>
			<button
				type="button"
				onClick={onArchive}
				className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
				aria-label="Archive"
			>
				<Archive className="size-5" />
			</button>
			<button
				type="button"
				onClick={onDelete}
				className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
				aria-label="Move to Trash"
			>
				<Trash2 className="size-5" />
			</button>
			<div className="relative">
				<button
					type="button"
					onClick={onMoreOpen}
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
					aria-label="More actions"
					aria-expanded={moreOpen}
				>
					<EllipsisVertical className="size-5" />
				</button>
				{moreOpen && (
					<div className="absolute right-0 top-full mt-1 z-50 min-w-44 flex flex-col bg-surface border border-line rounded-md shadow-lg">
						<button
							type="button"
							className="flex items-center gap-3 px-4 py-3 min-h-11 text-sm text-left hover:bg-surface-raised transition-colors"
						>
							<Mail className="size-4 shrink-0" />
							Mark as unread
						</button>
						<button
							type="button"
							className="flex items-center gap-3 px-4 py-3 min-h-11 text-sm text-left hover:bg-surface-raised transition-colors"
						>
							<MailOpen className="size-4 shrink-0" />
							Move to folder…
						</button>
					</div>
				)}
			</div>
			<button
				type="button"
				onClick={onIntelligence}
				className={`min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised${intelligenceOpen ? " bg-accent-2-soft text-accent-2" : ""}`}
				aria-label={
					intelligenceOpen
						? "Hide intelligence panel"
						: "Show intelligence panel"
				}
				aria-pressed={intelligenceOpen}
			>
				<Info className="size-5" />
			</button>
		</div>
	);
}

function ActionBar({ onBack }: { onBack: () => void }) {
	return (
		<div
			className="sticky bottom-0 bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80 border-t border-line px-4 py-3"
			style={{
				paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0))",
			}}
		>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onBack}
					className={chip}
					aria-label="Back"
				>
					<ArrowLeft className="size-4" />
					<span className="hidden sm:inline">Back</span>
				</button>
				<button type="button" className={chip} aria-label="Reply">
					<Reply className="size-4" />
					<span className="hidden sm:inline">Reply</span>
				</button>
				<button type="button" className={chip} aria-label="Reply all">
					<ReplyAll className="size-4" />
					<span className="hidden sm:inline">Reply all</span>
				</button>
				<button type="button" className={chip} aria-label="Forward">
					<Forward className="size-4" />
					<span className="hidden sm:inline">Forward</span>
				</button>
			</div>
		</div>
	);
}

function MessagePlaceholder() {
	return (
		<div className="px-5 py-4 border-b border-line">
			<div className="flex items-start gap-3">
				<div className="size-10 rounded-full bg-surface-sunken shrink-0 mt-0.5" />
				<div className="flex-1 min-w-0">
					<div className="flex items-baseline justify-between gap-2">
						<span className="text-sm font-semibold text-fg">
							Priya Natarajan
						</span>
						<span className="text-2xs text-fg-subtle tabular-nums shrink-0">
							09:15
						</span>
					</div>
					<p className="mt-1 text-sm text-fg-muted leading-relaxed">
						Hi — the Q3 revenue report is attached. Let me know if you need
						anything else before the board call. Numbers look strong across all
						regions, particularly APAC where we're up 23% quarter-on-quarter.
					</p>
					<p className="mt-3 text-sm text-fg-muted">
						Let me know if you have questions!
					</p>
					<p className="mt-2 text-sm text-fg-muted">— Priya</p>
				</div>
			</div>
		</div>
	);
}

function IntelligencePanelMock({ onClose }: { onClose: () => void }) {
	return (
		<div className="flex h-full flex-col bg-surface-sunken">
			<header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
				<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
					Intelligence
				</span>
				<button
					type="button"
					onClick={onClose}
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-fg-muted hover:bg-surface-raised"
					aria-label="Close"
				>
					<span aria-hidden>✕</span>
				</button>
			</header>
			<div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm text-fg-muted">
				<div className="space-y-1">
					<p className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						Sender
					</p>
					<p className="font-medium text-fg">Priya Natarajan</p>
					<p className="text-xs text-fg-muted">priya@northwind.example</p>
				</div>
				<div className="space-y-2">
					<p className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						Quick actions
					</p>
					<button
						type="button"
						className="w-full text-left rounded border border-line px-3 py-2 text-sm hover:bg-surface-raised transition-colors"
					>
						⭐ Mark as VIP
					</button>
					<button
						type="button"
						className="w-full text-left rounded border border-line px-3 py-2 text-sm hover:bg-surface-raised transition-colors"
					>
						🔇 Mute sender
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * Full mobile conversation: top bar with management actions + message body +
 * bottom action bar. Renders at 390 × 844 (iPhone 14) dimensions so
 * Storybook shows it at phone width.
 */
function MobileConversationDemo({
	startIntelligenceOpen = false,
}: {
	startIntelligenceOpen?: boolean;
}) {
	const [isStarred, setIsStarred] = useState(false);
	const [moreOpen, setMoreOpen] = useState(false);
	const [intelligenceOpen, setIntelligenceOpen] = useState(
		startIntelligenceOpen,
	);
	const [lastAction, setLastAction] = useState<string | null>(null);

	const announce = (msg: string) => {
		setLastAction(msg);
		setTimeout(() => setLastAction(null), 2000);
	};

	return (
		<div
			className="relative bg-canvas text-fg font-sans flex flex-col"
			style={{
				width: 390,
				height: 844,
				overflow: "hidden",
				border: "1px solid var(--color-line)",
			}}
		>
			{/* Global mobile top bar (hamburger + mailbox name — owned by mail.tsx) */}
			<div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas px-3">
				<div className="size-9 rounded bg-surface-sunken" />
				<span className="flex-1 text-sm font-semibold text-fg">Inbox</span>
			</div>

			{/* Per-conversation action top bar */}
			<TopBar
				isStarred={isStarred}
				onStar={() => {
					setIsStarred((v) => !v);
					announce(isStarred ? "Unflagged" : "Flagged");
				}}
				onArchive={() => announce("Archived")}
				onDelete={() => announce("Moved to Trash")}
				onMoreOpen={() => setMoreOpen((v) => !v)}
				moreOpen={moreOpen}
				intelligenceOpen={intelligenceOpen}
				onIntelligence={() => setIntelligenceOpen((v) => !v)}
			/>

			{/* Thread content */}
			<div className="flex-1 overflow-auto">
				<div className="px-5 pt-5 pb-3 border-b border-line">
					<h1 className="text-lg font-semibold leading-snug text-fg">
						Q3 Revenue Report — Board Call Prep
					</h1>
					<p className="mt-1 text-2xs text-fg-subtle">1 message</p>
				</div>
				<MessagePlaceholder />
			</div>

			{/* Feedback banner */}
			{lastAction && (
				<div className="absolute top-24 left-0 right-0 flex justify-center pointer-events-none">
					<span className="bg-fg text-canvas text-xs font-medium px-4 py-2 rounded-full shadow">
						{lastAction}
					</span>
				</div>
			)}

			{/* Intelligence right-side drawer */}
			{intelligenceOpen && (
				<div className="absolute inset-y-0 right-0 w-72 z-50 shadow-xl border-l border-line">
					<IntelligencePanelMock onClose={() => setIntelligenceOpen(false)} />
				</div>
			)}

			{/* Bottom reply bar */}
			<ActionBar onBack={() => announce("Back")} />
		</div>
	);
}

const meta: Meta = {
	title: "Screens/MobileConversation",
	parameters: { layout: "centered" },
};
export default meta;

type Story = StoryObj;

/**
 * Mobile conversation view at iPhone 14 dimensions (390 × 844).
 * Top bar: star, archive, delete, ⋮ (mark read/move), info (ⓘ).
 * Bottom bar: back, reply, reply-all, forward.
 * Tap the ⭐ to toggle the flag, ℹ️ to open the intelligence drawer.
 */
export const Default: Story = {
	render: () => <MobileConversationDemo />,
};

/**
 * Intelligence drawer open by default — shows the right-side panel that
 * slides in from the ⓘ button. The ⓘ button lights up in accent-2.
 */
export const IntelligenceOpen: Story = {
	render: () => <MobileConversationDemo startIntelligenceOpen />,
};
