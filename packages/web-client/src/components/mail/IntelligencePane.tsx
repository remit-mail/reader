import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	IntelligencePanel,
	type IntelligenceQuickActions,
	type SimilarState,
} from "@remit/ui";
import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useInboxMailbox, useJunkMailbox } from "@/hooks/useArchiveMailbox";
import { useIntelligenceData } from "@/hooks/useIntelligenceData";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useUpdateAddressFlags } from "@/hooks/useUpdateAddressFlags";

export interface IntelligencePaneProps {
	onClose: () => void;
	/**
	 * The currently selected thread row. When present, the real
	 * `IntelligencePanel` renders with wired data; when absent the pane shows
	 * the empty-state placeholder.
	 */
	thread?: RemitImapThreadMessageResponse;
	/** The mailbox the message list is currently showing — the move source. */
	mailboxId?: string;
	/** Account that owns `mailboxId`; resolves the Junk/Inbox move targets. */
	accountId?: string;
	/**
	 * Hide the panel's own close (X). Set when hosted inside the mobile Drawer,
	 * whose header already renders a close button — one way back, not two (#874).
	 */
	hideCloseButton?: boolean;
}

/**
 * Category-override values accepted by the `AddressFlags.category` override
 * (PATCH /addresses/{id}). Matches `MessageCategory` — the full taxonomy the
 * user can assign as a sender-level override.
 */
const CATEGORY_OVERRIDES = [
	"personal",
	"newsletter",
	"marketing",
	"automated",
	"transactional",
	"social",
] as const;
type CategoryOverride = (typeof CATEGORY_OVERRIDES)[number];

/**
 * Decide which spam quick-action to offer for the current message (issue #594).
 *
 * The two buttons are symmetric and mutually exclusive:
 * - In the Junk mailbox → offer **Not spam** (move out, promote sender), but
 *   only when an Inbox destination is resolved.
 * - Anywhere else → offer **Mark spam** (move in, demote sender), but only when
 *   the Junk destination is resolved.
 *
 * Returns `"notSpam"`, `"markSpam"`, or `null` (no actionable button — e.g. the
 * move source isn't known, or the needed target mailbox hasn't loaded). Pure so
 * the wiring decision can be unit-tested without rendering.
 */
export const resolveSpamAction = (input: {
	mailboxId?: string;
	junkMailboxId?: string;
	inboxMailboxId?: string;
}): "notSpam" | "markSpam" | null => {
	const { mailboxId, junkMailboxId, inboxMailboxId } = input;
	if (!mailboxId) return null;
	const isInJunk = Boolean(junkMailboxId && mailboxId === junkMailboxId);
	if (isInJunk) return inboxMailboxId ? "notSpam" : null;
	return junkMailboxId ? "markSpam" : null;
};

/**
 * Decide the "Similar messages" section state from the semantic-search query.
 *
 * The fail-fast rule: a fatal first-party 5xx must NEVER degrade to the benign
 * grey "Similarity search unavailable" label — it escalates to the global red
 * overlay instead, so this returns `"ready"` for it (the section then renders
 * nothing rather than a misleading soft state). A soft (non-fatal) failure
 * keeps the muted `"error"` state; an empty result is `"ready"` (no error).
 * Pure so the classification can be unit-tested without rendering.
 */
export const resolveSimilarState = (input: {
	similarError: unknown;
	similarErrorIsFatal: boolean;
	isSimilarLoading: boolean;
}): SimilarState => {
	const { similarError, similarErrorIsFatal, isSimilarLoading } = input;
	if (similarError && !similarErrorIsFatal) return "error";
	if (isSimilarLoading) return "loading";
	return "ready";
};

function IntelligenceSkeleton() {
	return (
		<aside className="flex h-full w-full flex-col bg-surface-sunken">
			<header className="flex h-pane-header shrink-0 items-center gap-1.5 border-b border-line px-row-inset">
				<Sparkles className="size-3.5 text-fg-subtle" />
				<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
					Intelligence
				</span>
			</header>
			<div className="flex-1 animate-pulse space-y-4 p-4">
				<div className="space-y-2">
					<div className="h-2.5 rounded bg-surface w-1/4" />
					<div className="flex gap-3">
						<div className="size-10 rounded-full bg-surface shrink-0" />
						<div className="flex-1 space-y-1.5">
							<div className="h-3 rounded bg-surface w-3/4" />
							<div className="h-2.5 rounded bg-surface w-1/2" />
						</div>
					</div>
				</div>
				<div className="space-y-2">
					<div className="h-2.5 rounded bg-surface w-1/4" />
					<div className="h-8 rounded bg-surface" />
				</div>
				<div className="space-y-2">
					<div className="h-2.5 rounded bg-surface w-1/4" />
					<div className="flex gap-1.5 flex-wrap">
						{Array.from({ length: 5 }).map((_, i) => (
							<div key={i} className="h-6 w-16 rounded bg-surface" />
						))}
					</div>
				</div>
			</div>
		</aside>
	);
}

/**
 * Reclassify picker: a small modal listing the category-override options. On
 * selection it PATCHes `AddressFlags.category` for the sender.
 */
function ReclassifyDialog({
	isOpen,
	current,
	onSelect,
	onCancel,
}: {
	isOpen: boolean;
	current: string;
	onSelect: (category: CategoryOverride) => void;
	onCancel: () => void;
}) {
	if (!isOpen) return null;
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			role="presentation"
			onClick={onCancel}
		>
			<div className="absolute inset-0 bg-canvas/80 backdrop-blur-sm" />
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Reclassify sender"
				className="relative z-10 w-full max-w-sm rounded-sm border border-line bg-surface p-6 shadow-lg"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-lg font-semibold">Reclassify this sender</h2>
				<p className="mt-2 text-sm text-fg-muted">
					Set a category override for future messages from this sender.
				</p>
				<div className="mt-4 flex flex-col gap-1">
					{CATEGORY_OVERRIDES.map((cat) => (
						<button
							key={cat}
							type="button"
							onClick={() => onSelect(cat)}
							className={`flex min-h-11 items-center justify-between rounded px-3 text-left text-sm capitalize transition-colors hover:bg-surface-raised ${
								cat === current ? "font-semibold text-accent" : "text-fg"
							}`}
						>
							{cat}
							{cat === current && (
								<span className="text-2xs text-fg-subtle">current</span>
							)}
						</button>
					))}
				</div>
				<div className="mt-6 flex justify-end">
					<button
						type="button"
						onClick={onCancel}
						className="inline-flex min-h-11 items-center justify-center rounded border border-line px-4 text-sm font-medium transition-colors hover:bg-surface-raised"
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}

interface WiredPanelProps {
	thread: RemitImapThreadMessageResponse;
	onClose: () => void;
	mailboxId?: string;
	accountId?: string;
	hideCloseButton?: boolean;
}

/**
 * Inner panel that resolves intelligence data and wires quick-action mutations.
 */
function WiredPanel({
	thread,
	onClose,
	mailboxId,
	accountId,
	hideCloseButton,
}: WiredPanelProps) {
	const {
		data,
		addressId,
		isSimilarLoading,
		similarError,
		similarErrorIsFatal,
	} = useIntelligenceData(thread);
	const [confirmBlock, setConfirmBlock] = useState(false);
	const [reclassifyOpen, setReclassifyOpen] = useState(false);
	const senderEmail = thread.fromEmail ?? undefined;

	const { updateFlags, isPending } = useUpdateAddressFlags({
		addressId,
		senderEmail,
	});

	// "Not spam" / "Mark spam" move the message across the Junk boundary; the
	// backend's moveMessage then promotes (out of Junk) or demotes (into Junk)
	// the sender's trust (issue #594). Only one button is wired at a time,
	// depending on whether the message is currently sitting in Junk.
	const { junkMailboxId } = useJunkMailbox(accountId);
	const { inboxMailboxId } = useInboxMailbox(accountId);
	const { moveMessages } = useMoveMessages({
		mailboxId: mailboxId ?? "",
		threadId: thread.threadId,
		accountId,
	});

	const spamAction = resolveSpamAction({
		mailboxId,
		junkMailboxId,
		inboxMailboxId,
	});

	const handleNotSpam = useCallback(() => {
		if (!inboxMailboxId) return;
		moveMessages([thread.messageId], inboxMailboxId);
	}, [inboxMailboxId, moveMessages, thread.messageId]);

	const handleMarkSpam = useCallback(() => {
		if (!junkMailboxId) return;
		moveMessages([thread.messageId], junkMailboxId);
	}, [junkMailboxId, moveMessages, thread.messageId]);

	const handleShowSimilar = useCallback(() => {
		// The similar-messages section scrolls into view automatically when
		// data.similar is populated. This handler is for the "N similar" button
		// inside the authenticity panel; a scroll-to implementation can be added
		// in a future pass without breaking the contract.
	}, []);

	const handleToggleVip = useCallback(() => {
		const next = !(data?.flags?.vip === true);
		updateFlags({ vip: { value: next } });
	}, [data?.flags?.vip, updateFlags]);

	const handleToggleMute = useCallback(() => {
		const next = !(data?.flags?.muted === true);
		updateFlags({ muted: { value: next } });
	}, [data?.flags?.muted, updateFlags]);

	const handleToggleBlock = useCallback(() => {
		if (data?.flags?.blocked === true) {
			// Unblock — no confirm needed
			updateFlags({ blocked: { value: false } });
		} else {
			setConfirmBlock(true);
		}
	}, [data?.flags?.blocked, updateFlags]);

	const handleBlockConfirm = useCallback(() => {
		setConfirmBlock(false);
		updateFlags({ blocked: { value: true } });
	}, [updateFlags]);

	const handleToggleUnsubscribe = useCallback(() => {
		const next = !(data?.flags?.unsubscribed === true);
		updateFlags({ unsubscribed: { value: next } });
	}, [data?.flags?.unsubscribed, updateFlags]);

	const handleToggleAutoArchive = useCallback(() => {
		const next = !(data?.flags?.autoArchive === true);
		updateFlags({ autoArchive: { value: next } });
	}, [data?.flags?.autoArchive, updateFlags]);

	const handleReclassifySelect = useCallback(
		(category: CategoryOverride) => {
			setReclassifyOpen(false);
			updateFlags({ category: { value: category } });
		},
		[updateFlags],
	);

	// Per-sender flag toggles are always wired. They stay active even before the
	// address record resolves: `updateFlags` surfaces feedback when `addressId`
	// is missing rather than letting the button look active but do nothing.
	const actions: IntelligenceQuickActions = {
		onToggleVip: handleToggleVip,
		onToggleMute: handleToggleMute,
		onToggleBlock: handleToggleBlock,
		onToggleUnsubscribe: handleToggleUnsubscribe,
		onToggleAutoArchive: handleToggleAutoArchive,
		onReclassify: () => setReclassifyOpen(true),
		onNotSpam: spamAction === "notSpam" ? handleNotSpam : undefined,
		onMarkSpam: spamAction === "markSpam" ? handleMarkSpam : undefined,
	};

	if (!data) {
		return <IntelligenceSkeleton />;
	}

	const similarState = resolveSimilarState({
		similarError,
		similarErrorIsFatal,
		isSimilarLoading,
	});

	return (
		<>
			<IntelligencePanel
				data={data}
				onClose={onClose}
				hideCloseButton={hideCloseButton}
				onShowSimilar={handleShowSimilar}
				actions={actions}
				similarState={similarState}
				// No left border: the ResizableHandle to our left already draws the
				// hairline seam. The remit-ui IntelligencePanel default `border-l`
				// would double it to 2px.
				className="border-l-0 h-full w-full"
			/>
			<ConfirmDialog
				isOpen={confirmBlock}
				title="Block this sender?"
				description={`Messages from ${senderEmail ?? "this sender"} will never load images and will be flagged. You can undo this in Settings → Senders.`}
				confirmLabel="Block sender"
				destructive
				isBusy={isPending}
				onConfirm={handleBlockConfirm}
				onCancel={() => setConfirmBlock(false)}
			/>
			<ReclassifyDialog
				isOpen={reclassifyOpen}
				current={data.category.value}
				onSelect={handleReclassifySelect}
				onCancel={() => setReclassifyOpen(false)}
			/>
		</>
	);
}

/**
 * Pane 4 of the 4-pane shell: the intelligence sidebar. Wired to real data via
 * `useIntelligenceData`; renders the `IntelligencePanel` from `@remit/ui`.
 *
 * Data flow:
 * - Sender basics + trust + authenticity + category: from the thread row (instant,
 *   already loaded by the message list).
 * - Address flags (VIP/muted/blocked/etc.) + first-seen: `GET /addresses/search`.
 * - Similar messages: `GET /search/semantic` (last; panel still renders on failure).
 */
export const IntelligencePane = ({
	onClose,
	thread,
	mailboxId,
	accountId,
	hideCloseButton,
}: IntelligencePaneProps) => {
	if (!thread) {
		return (
			<aside className="flex h-full w-full flex-col bg-surface-sunken">
				<header className="flex h-pane-header shrink-0 items-center gap-1.5 border-b border-line px-row-inset">
					<Sparkles className="size-3.5 text-fg-subtle" />
					<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
						Intelligence
					</span>
				</header>
				<div className="flex flex-1 flex-col items-center justify-center px-row-inset text-center">
					<Sparkles className="size-8 text-fg-subtle" />
					<p className="mt-3 text-sm text-fg-muted">Intelligence</p>
					<p className="mt-1 text-2xs text-fg-subtle">
						Sender trust, authenticity and similar messages will appear here.
					</p>
				</div>
			</aside>
		);
	}

	return (
		<WiredPanel
			thread={thread}
			onClose={onClose}
			mailboxId={mailboxId}
			accountId={accountId}
			hideCloseButton={hideCloseButton}
		/>
	);
};
