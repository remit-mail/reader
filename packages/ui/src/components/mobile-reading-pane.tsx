import { ArrowLeft, Info } from "lucide-react";
import { type HTMLAttributes, type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import type { ThreadData } from "./app-shell-types.js";
import { Button } from "./button.js";
import { Dialog } from "./dialog.js";
import {
	type IntelligenceData,
	IntelligencePanel,
} from "./intelligence-panel.js";
import { MobileMessageActionBar } from "./mobile-message-action-bar.js";
import { CollapsedMessage, ExpandedMessage } from "./reading-pane.js";

export interface MobileReadingMessageActions {
	/** Expand / collapse a message row. */
	onToggleExpand?: (id: string) => void;
	onReply?: (id: string) => void;
	onReplyAll?: (id: string) => void;
	onForward?: (id: string) => void;
	onToggleStar?: (id: string) => void;
	onDelete?: (id: string) => void;
	onToggleRead?: (id: string) => void;
	/** Per-message move-to-folder trigger (the app supplies the folder picker). */
	moveSlot?: (id: string) => ReactNode;
}

export interface MobileReadingPaneProps {
	thread: ThreadData;
	/** Back to the message list. */
	onBack: () => void;
	/**
	 * Intelligence for the active (expanded) message. Drives the single top-bar
	 * toggle; in a multi-message thread the caller passes the data for whichever
	 * message is currently expanded. Omit to hide the toggle.
	 */
	intelligence?: IntelligenceData;
	/** Controlled open state for the intelligence sheet. Omit for internal state. */
	intelligenceOpen?: boolean;
	onToggleIntelligence?: () => void;
	actions?: MobileReadingMessageActions;
	/**
	 * Live message content. When provided it replaces the static
	 * `thread.messages` rendering so the app can inject its own message cards
	 * (each expanded card owns its `MobileMessageActionBar`). `thread.subject`
	 * still drives the top bar.
	 */
	children?: ReactNode;
	/** Touch handlers attached to the scroll area (swipe-between-messages). */
	touchHandlers?: HTMLAttributes<HTMLDivElement>;
}

/**
 * The narrow-width (single-pane) mobile reading view, and the one shared shell
 * every mobile reading mock composes. The chrome is fixed: a top app bar with
 * back, the email subject and — its only other control — the intelligence
 * toggle for the active message. Each expanded message carries its own
 * `MobileMessageActionBar` (reply / star / move / delete / overflow); collapsed
 * rows carry none. There is no thread-level reply footer — reply belongs to the
 * message it answers. Feed it a `thread` and per-message `actions`; it owns the
 * layout so no mock hand-rolls it.
 */
export function MobileReadingPane({
	thread,
	onBack,
	intelligence,
	intelligenceOpen,
	onToggleIntelligence,
	actions,
	children,
	touchHandlers,
}: MobileReadingPaneProps) {
	const [localIntelligenceOpen, setLocalIntelligenceOpen] = useState(false);
	const controlled = onToggleIntelligence !== undefined;
	const isOpen = controlled
		? (intelligenceOpen ?? false)
		: localIntelligenceOpen;
	const showIntelligenceToggle = Boolean(intelligence) || controlled;

	const toggleIntelligence = () => {
		if (controlled) {
			onToggleIntelligence?.();
			return;
		}
		setLocalIntelligenceOpen((value) => !value);
	};

	const closeIntelligence = () => {
		if (controlled) {
			if (isOpen) onToggleIntelligence?.();
			return;
		}
		setLocalIntelligenceOpen(false);
	};

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
				<h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					{thread.subject}
				</h2>
				{showIntelligenceToggle && (
					<Button
						variant="ghost"
						size="sm"
						icon={<Info className="size-4" />}
						onClick={toggleIntelligence}
						aria-label={
							isOpen ? "Hide intelligence panel" : "Show intelligence panel"
						}
						aria-pressed={isOpen}
						title="Intelligence"
						className={cn(
							"shrink-0",
							isOpen && "bg-accent-2-soft text-accent-2",
						)}
					/>
				)}
			</header>

			<div
				className="flex-1 overflow-y-auto"
				style={touchHandlers ? { touchAction: "pan-y" } : undefined}
				{...touchHandlers}
			>
				{children ??
					thread.messages.map((message) => {
						const bind = (handler?: (id: string) => void) =>
							handler ? () => handler(message.id) : undefined;

						if (!message.expanded) {
							return (
								<CollapsedMessage
									key={message.id}
									message={message}
									onClick={bind(actions?.onToggleExpand)}
								/>
							);
						}

						return (
							<ExpandedMessage
								key={message.id}
								message={message}
								warning={thread.warning}
								onHeaderClick={bind(actions?.onToggleExpand)}
								actionBar={
									<MobileMessageActionBar
										hasThread
										onReply={bind(actions?.onReply)}
										onReplyAll={bind(actions?.onReplyAll)}
										onForward={bind(actions?.onForward)}
										onToggleStar={bind(actions?.onToggleStar)}
										onDelete={bind(actions?.onDelete)}
										onToggleRead={bind(actions?.onToggleRead)}
										moveSlot={actions?.moveSlot?.(message.id)}
									/>
								}
							/>
						);
					})}
			</div>

			{intelligence && !controlled && (
				<Dialog
					open={isOpen}
					onClose={closeIntelligence}
					title="Intelligence"
					anchor="right"
					className="p-0"
				>
					<IntelligencePanel
						data={intelligence}
						onClose={closeIntelligence}
						className="h-full w-full border-l-0"
					/>
				</Dialog>
			)}
		</article>
	);
}
