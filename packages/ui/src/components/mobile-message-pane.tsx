import { ArrowLeft, Info, MessagesSquare } from "lucide-react";
import {
	type HTMLAttributes,
	type ReactNode,
	useEffect,
	useState,
} from "react";
import type { ThreadData } from "./app-shell-types.js";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import {
	type IntelligenceData,
	IntelligencePanel,
} from "./intelligence-panel.js";
import { MailActionToolbar } from "./mail-action-toolbar.js";
import { CollapsedMessage, ExpandedMessage } from "./reading-pane.js";

/* ------------------------------------------------------------------ */
/* Narrow-width message view (single pane below 1024px)              */
/* ------------------------------------------------------------------ */

export interface MobileMessagePaneProps {
	/**
	 * Static kit data for the Storybook / SSR reference build.
	 * In the live app, omit `thread` and pass `children` instead.
	 */
	thread?: ThreadData;
	intelligence?: IntelligenceData;
	/** Navigates back to the message list. */
	onBack: () => void;
	/**
	 * Optional management bar rendered between the header and the scroll
	 * area (star / archive / delete / overflow for touch triage).
	 * Accepts any ReactNode — typically `<MobileConversationTopBar>`.
	 */
	managementBar?: ReactNode;
	/**
	 * Message list content. When provided, replaces the static
	 * `ExpandedMessage`/`CollapsedMessage` rendering of `thread.messages`
	 * so the live app can supply its own real `<MessageCard>` components.
	 */
	children?: ReactNode;
	/**
	 * When provided, replaces `MailActionToolbar` with this slot — use it
	 * for an inline compose that takes over the footer while active.
	 */
	composeSlot?: ReactNode;
	/** Opens the message-details / intelligence drawer from the toolbar. */
	onInfo?: () => void;
	/**
	 * Whether the intelligence panel / details drawer is currently open.
	 * Drives the pressed state on the header ℹ button.
	 */
	intelligenceOpen?: boolean;
	/* ---- Footer toolbar reply verbs ----
	 * The mobile footer toolbar owns only reply / reply-all / forward (+ the
	 * details button). Triage (archive / trash / flag / move) lives in the
	 * `managementBar`, so the toolbar's triage cluster is suppressed here to
	 * avoid duplicate accessible names. */
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	/**
	 * One-line inline notice shown under the footer toolbar when a reply verb
	 * can't run yet (e.g. "Configure SMTP to send mail"). Defaults to a generic
	 * "Open a message first".
	 */
	replyUnavailableHint?: ReactNode;
	/**
	 * When false, pressing a reply verb surfaces `replyUnavailableHint` instead
	 * of invoking the handler — used to explain that SMTP isn't configured
	 * without ever disabling the button (the never-disable tenet).
	 */
	canReply?: boolean;
	/**
	 * Touch event handlers to attach to the scrollable message area for
	 * swipe-between-messages gestures (horizontal swipe → prev / next).
	 */
	touchHandlers?: HTMLAttributes<HTMLDivElement>;
}

export function MobileMessagePane({
	thread,
	intelligence,
	onBack,
	managementBar,
	children,
	composeSlot,
	onInfo,
	intelligenceOpen: intelligenceOpenProp,
	onReply,
	onReplyAll,
	onForward,
	replyUnavailableHint,
	canReply = true,
	touchHandlers,
}: MobileMessagePaneProps) {
	// The header ℹ button opens the kit-level intelligence Dialog when the caller
	// passes `intelligence` without an `onInfo` handler. In the live app the
	// caller controls the drawer via `intelligenceOpenProp` / `onInfo`; the
	// local state is only used in the kit reference stories.
	const [localIntelligenceOpen, setLocalIntelligenceOpen] = useState(false);
	const isKitIntelligence = !!intelligence && !onInfo;
	const intelligenceOpen = onInfo
		? (intelligenceOpenProp ?? false)
		: localIntelligenceOpen;

	const [hint, setHint] = useState<ReactNode>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (intelligenceOpen) return; // Dialog / Drawer handles Escape while open
			onBack();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onBack, intelligenceOpen]);

	// The header ℹ button is only shown in kit stories where the caller passes
	// `intelligence` without an external `onInfo`. When `onInfo` is provided the
	// caller's management bar (e.g. MobileConversationTopBar) already carries a
	// "Show intelligence panel" affordance — showing a second one here would
	// create duplicate accessible names and break strict-mode locators.
	const showHeaderIntelligenceButton = isKitIntelligence;

	return (
		<article className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line bg-surface px-row-inset">
				<Button
					variant="ghost"
					size="sm"
					icon={<ArrowLeft className="size-4" />}
					onClick={onBack}
					aria-label="Back to messages"
					className="-ml-1 shrink-0"
				/>
				{thread && (
					<h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
						{thread.subject}
					</h2>
				)}
				{!thread && <div className="flex-1" />}
				{showHeaderIntelligenceButton && (
					<Button
						variant="ghost"
						size="sm"
						icon={<Info className="size-4" />}
						onClick={() => setLocalIntelligenceOpen(true)}
						aria-label="Show intelligence panel"
						aria-pressed={localIntelligenceOpen}
						className="shrink-0"
					/>
				)}
			</header>

			{managementBar}

			<div
				className="flex-1 overflow-y-auto"
				style={touchHandlers ? { touchAction: "pan-y" } : undefined}
				{...touchHandlers}
			>
				{children ??
					(thread && (
						<>
							<div className="border-b border-line px-5 pt-5 pb-3">
								<p className="text-2xs text-fg-subtle">
									{thread.messages.length}{" "}
									{thread.messages.length === 1 ? "message" : "messages"}
								</p>
							</div>
							{thread.messages.map((message) =>
								message.expanded ? (
									<ExpandedMessage
										key={message.id}
										message={message}
										warning={thread.warning}
									/>
								) : (
									<CollapsedMessage key={message.id} message={message} />
								),
							)}
						</>
					))}
			</div>

			{composeSlot ?? (
				<MailActionToolbar
					hasThread={canReply}
					/* The management bar (when present) owns triage; suppress the
					   footer's triage cluster to avoid duplicate accessible names.
					   Without a management bar (kit reference / stories) the footer
					   keeps the full cluster as the standalone pane design. */
					showTriage={!managementBar}
					onUnavailable={() =>
						setHint(replyUnavailableHint ?? "Open a message first")
					}
					unavailableHint={canReply ? hint : (replyUnavailableHint ?? hint)}
					onReply={onReply}
					onReplyAll={onReplyAll}
					onForward={onForward}
					className="border-t border-b-0"
				>
					{onInfo && (
						<Button
							variant="ghost"
							size="sm"
							icon={<MessagesSquare className="size-4" />}
							onClick={onInfo}
							aria-label="Message details"
							title="Message details"
						/>
					)}
				</MailActionToolbar>
			)}

			{isKitIntelligence && (
				<Dialog
					open={localIntelligenceOpen}
					onClose={() => setLocalIntelligenceOpen(false)}
					title="Intelligence"
					anchor="right"
					className="p-0"
				>
					<IntelligencePanel
						data={intelligence}
						onClose={() => setLocalIntelligenceOpen(false)}
						className="h-full w-full border-l-0"
					/>
				</Dialog>
			)}
		</article>
	);
}
