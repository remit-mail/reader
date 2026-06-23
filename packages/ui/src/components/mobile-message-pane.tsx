import { ArrowLeft, Info } from "lucide-react";
import { useEffect, useState } from "react";
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

export function MobileMessagePane({
	thread,
	intelligence,
	onBack,
}: {
	thread: ThreadData;
	intelligence?: IntelligenceData;
	onBack: () => void;
}) {
	const [intelligenceOpen, setIntelligenceOpen] = useState(false);
	const [hint, setHint] = useState<string | null>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (intelligenceOpen) return; // Dialog handles Escape while open
			onBack();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onBack, intelligenceOpen]);

	return (
		<article className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line bg-surface px-row-inset">
				<Button
					variant="ghost"
					size="sm"
					icon={<ArrowLeft className="size-4" />}
					onClick={onBack}
					aria-label="Back to list"
					className="-ml-1 shrink-0"
				/>
				<h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
					{thread.subject}
				</h2>
				{intelligence && (
					<Button
						variant="ghost"
						size="sm"
						icon={<Info className="size-4" />}
						onClick={() => setIntelligenceOpen(true)}
						aria-label="Show intelligence panel"
						aria-pressed={intelligenceOpen}
						className="shrink-0"
					/>
				)}
			</header>

			<div className="flex-1 overflow-y-auto">
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
			</div>

			<MailActionToolbar
				hasThread
				onUnavailable={() => setHint("Open a message first")}
				unavailableHint={hint}
				className="border-t border-b-0"
			/>

			{intelligence && (
				<Dialog
					open={intelligenceOpen}
					onClose={() => setIntelligenceOpen(false)}
					title="Intelligence"
					anchor="right"
					className="p-0"
				>
					<IntelligencePanel
						data={intelligence}
						onClose={() => setIntelligenceOpen(false)}
						className="h-full w-full border-l-0"
					/>
				</Dialog>
			)}
		</article>
	);
}
