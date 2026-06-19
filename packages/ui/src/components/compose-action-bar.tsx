import { Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "./button.js";

export type ComposeSaveStatus = "idle" | "saving" | "saved" | "error";

export interface ComposeActionBarProps {
	onSend: () => void;
	onDiscard: () => void;
	sending: boolean;
	canSend: boolean;
	saveStatus?: ComposeSaveStatus;
	/**
	 * Why sending is unavailable (e.g. "SMTP not configured"). Shown on the
	 * Send button as a tooltip; surfaced to the user on press via
	 * `onUnavailable` rather than disabling the control.
	 */
	unavailableReason?: string;
	/** Called when Send is pressed while it cannot act — explain, don't disable. */
	onUnavailable?: (reason: string) => void;
}

const SaveStatusIndicator = ({ status }: { status: ComposeSaveStatus }) => {
	if (status === "saving") {
		return (
			<span className="animate-pulse text-xs text-fg-muted">Saving...</span>
		);
	}
	if (status === "saved") {
		return <span className="text-xs text-fg-muted">Draft saved</span>;
	}
	if (status === "error") {
		return <span className="text-xs text-danger">Save failed</span>;
	}
	return null;
};

/**
 * Compose footer: Send + Discard. Send stays pressable even when it can't act
 * yet — on press it explains why via `onUnavailable` instead of being
 * disabled (never-disable). The pill keeps a fixed min-height so it never
 * clips below the fold on mobile.
 */
export function ComposeActionBar({
	onSend,
	onDiscard,
	sending,
	canSend,
	saveStatus = "idle",
	unavailableReason,
	onUnavailable,
}: ComposeActionBarProps) {
	return (
		<div className="flex items-center justify-between border-t border-line px-3 py-2">
			<div className="flex items-center gap-3">
				<Button
					variant="primary"
					size="md"
					aria-busy={sending}
					title={!canSend ? unavailableReason : undefined}
					className="min-h-11 rounded-full px-4"
					icon={
						sending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Send className="size-4" />
						)
					}
					onClick={() => {
						if (sending) return;
						if (!canSend) {
							if (unavailableReason) onUnavailable?.(unavailableReason);
							return;
						}
						onSend();
					}}
				>
					Send
				</Button>
				<SaveStatusIndicator status={saveStatus} />
			</div>
			<Button
				variant="ghost"
				size="md"
				aria-busy={sending}
				aria-label="Discard"
				className="min-h-11 min-w-11 px-2 hover:text-danger"
				icon={<Trash2 className="size-4" />}
				onClick={() => {
					if (sending) return;
					onDiscard();
				}}
			/>
		</div>
	);
}
