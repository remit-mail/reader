import { IntelligencePanel } from "@remit/ui";
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
import {
	newsletterIntelligence,
	phishIntelligence,
} from "../fixtures/workspace.js";

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

			{/* Intelligence right-side drawer — same geometry as the live Drawer
			    component: w-[80vw] max-w-[320px], slides in from right at z-50.
			    At 390px phone width this resolves to 312px (80vw). */}
			{intelligenceOpen && (
				<div
					className="absolute inset-y-0 right-0 z-50 shadow-xl border-l border-line bg-canvas flex flex-col"
					style={{ width: "min(80vw, 320px)" }}
				>
					<IntelligencePanel
						data={newsletterIntelligence}
						onClose={() => setIntelligenceOpen(false)}
						className="border-l-0 h-full w-full"
					/>
				</div>
			)}

			{/* Bottom reply bar */}
			<ActionBar onBack={() => announce("Back")} />
		</div>
	);
}

/**
 * Phone frame at 390 × 844 with the intelligence drawer open showing the full
 * quick-actions set (VIP, Mute, Block, Unsubscribe, Auto-archive) for a
 * newsletter sender. This is the design baseline for issue #854.
 *
 * Live layout: the drawer slides in from the right as a `w-[80vw] max-w-[320px]`
 * panel overlaying the conversation body. The ⓘ button in the top bar lights up
 * in accent-2 to indicate the drawer is open.
 */
function PhoneIntelligenceDrawerDemo({
	intelligenceData = newsletterIntelligence,
}: {
	intelligenceData?: typeof newsletterIntelligence;
}) {
	const [flags, setFlags] = useState({ ...intelligenceData.flags });

	const data = { ...intelligenceData, flags };

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
			{/* Global mobile top bar */}
			<div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas px-3">
				<div className="size-9 rounded bg-surface-sunken" />
				<span className="flex-1 text-sm font-semibold text-fg">Inbox</span>
			</div>

			{/* Per-conversation action top bar — ⓘ lit (drawer open) */}
			<div className="flex h-12 shrink-0 items-center justify-end gap-0.5 border-b border-line bg-canvas px-1">
				<button
					type="button"
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
					aria-label="Flag"
				>
					<Star className="size-5" />
				</button>
				<button
					type="button"
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
					aria-label="Archive"
				>
					<Archive className="size-5" />
				</button>
				<button
					type="button"
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors hover:bg-surface-raised"
					aria-label="Move to Trash"
				>
					<Trash2 className="size-5" />
				</button>
				{/* ⓘ active state: bg-accent-2-soft text-accent-2 */}
				<button
					type="button"
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-md transition-colors bg-accent-2-soft text-accent-2"
					aria-label="Hide intelligence panel"
					aria-pressed={true}
				>
					<Info className="size-5" />
				</button>
			</div>

			{/* Thread content (dimmed behind drawer scrim) */}
			<div className="flex-1 overflow-auto">
				<div className="px-5 pt-5 pb-3 border-b border-line">
					<h1 className="text-lg font-semibold leading-snug text-fg">
						{intelligenceData.sender.name} — Weekend deals
					</h1>
					<p className="mt-1 text-2xs text-fg-subtle">1 message</p>
				</div>
				<div className="px-5 py-4 border-b border-line opacity-40">
					<div className="flex items-start gap-3">
						<div className="size-10 rounded-full bg-surface-sunken shrink-0 mt-0.5" />
						<div className="flex-1 min-w-0">
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-sm font-semibold text-fg">
									{intelligenceData.sender.name}
								</span>
								<span className="text-2xs text-fg-subtle tabular-nums shrink-0">
									10:02
								</span>
							</div>
							<p className="mt-1 text-sm text-fg-muted leading-relaxed">
								Ontdek onze weekendaanbiedingen. Gratis bezorging op alles boven
								€ 30 — alleen dit weekend.
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Scrim behind drawer */}
			<div className="absolute inset-0 bg-black/40 z-40" />

			{/* Intelligence right-side drawer — real IntelligencePanel with all
			    quick actions wired. Geometry mirrors the live Drawer component:
			    w-[80vw] max-w-[320px], z-50, border-l, shadow-xl. */}
			<div
				className="absolute inset-y-0 right-0 z-50 shadow-xl border-l border-line bg-canvas flex flex-col"
				style={{ width: "min(80vw, 320px)" }}
			>
				<IntelligencePanel
					data={data}
					onClose={() => {}}
					className="border-l-0 h-full w-full overflow-y-auto"
					actions={{
						onToggleVip: () => setFlags((f) => ({ ...f, vip: !f.vip })),
						onToggleMute: () => setFlags((f) => ({ ...f, muted: !f.muted })),
						onToggleBlock: () =>
							setFlags((f) => ({ ...f, blocked: !f.blocked })),
						onToggleUnsubscribe: () =>
							setFlags((f) => ({ ...f, unsubscribed: !f.unsubscribed })),
						onToggleAutoArchive: () =>
							setFlags((f) => ({ ...f, autoArchive: !f.autoArchive })),
						onReclassify: () => {},
						onMarkSpam: () => {},
					}}
				/>
			</div>

			{/* Bottom reply bar */}
			<div
				className="sticky bottom-0 bg-canvas/95 backdrop-blur border-t border-line px-4 py-3 z-30"
				style={{
					paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0))",
				}}
			>
				<div className="flex items-center gap-2">
					<button type="button" className={chip} aria-label="Back">
						<ArrowLeft className="size-4" />
					</button>
					<button type="button" className={chip} aria-label="Reply">
						<Reply className="size-4" />
					</button>
					<button type="button" className={chip} aria-label="Reply all">
						<ReplyAll className="size-4" />
					</button>
					<button type="button" className={chip} aria-label="Forward">
						<Forward className="size-4" />
					</button>
				</div>
			</div>
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

/**
 * Phone intelligence drawer — full quick-actions set (newsletter sender).
 *
 * Design baseline for issue #854. Documents the LIVE implementation:
 * the drawer is a right-side overlay (w-[80vw] max-w-[320px], z-50, scrim
 * behind) containing the real `IntelligencePanel` from remit-ui with all
 * five quick actions: VIP, Mute, Block, Unsubscribe, Auto-archive.
 *
 * The existing `IntelligenceOpen` story used a minimal mock (VIP + Mute only).
 * This story captures what is actually live so design and code agree.
 * All five action chips are interactive — click to toggle their active state.
 */
export const PhoneIntelligenceDrawer: Story = {
	render: () => <PhoneIntelligenceDrawerDemo />,
};

/**
 * Phone intelligence drawer — phishing sender variant.
 *
 * Shows the drawer with a DKIM-mismatch sender (authenticity `"mismatch"`).
 * The authenticity section renders the red danger card and "N similar messages"
 * button. The quick-actions set is the same as the newsletter variant.
 */
export const PhoneIntelligenceDrawerPhishing: Story = {
	render: () => (
		<PhoneIntelligenceDrawerDemo intelligenceData={phishIntelligence} />
	),
};
