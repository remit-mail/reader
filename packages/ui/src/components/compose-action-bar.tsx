import { Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "./button.js";

export type ComposeSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Whether Send can act, and when it cannot, the sentence that says why.
 *
 * A blocked state cannot be built without its reason, so no arrangement of
 * props produces a Send press that reports nothing. The pair this replaces
 * could: a message with no recipient set `canSend` false and left the reason
 * undefined, and the press did nothing at all.
 */
export type ComposeSendState =
	| { status: "ready" }
	| { status: "sending" }
	| { status: "blocked"; reason: string };

export interface ComposeActionBarProps {
	send: ComposeSendState;
	onSend: () => void;
	/** Called with the reason when Send is pressed while it cannot act. */
	onBlocked: (reason: string) => void;
	onDiscard: () => void;
	saveStatus?: ComposeSaveStatus;
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
 * Compose footer: Send + Discard. Send stays pressable when it cannot act and
 * says why on press instead of greying out — a dead control leaves the user
 * guessing whether the app is broken or the message is. The pill keeps a fixed
 * min-height so it never clips below the fold on mobile.
 */
export function ComposeActionBar({
	send,
	onSend,
	onBlocked,
	onDiscard,
	saveStatus = "idle",
}: ComposeActionBarProps) {
	const sending = send.status === "sending";
	const blockedReason = send.status === "blocked" ? send.reason : undefined;

	return (
		<div className="flex items-center justify-between border-t border-line px-3 py-2">
			<div className="flex min-w-0 items-center gap-3">
				<Button
					variant="primary"
					size="md"
					aria-busy={sending}
					title={blockedReason}
					className="min-h-11 shrink-0 rounded-full px-4"
					data-testid="compose-send"
					icon={
						sending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Send className="size-4" />
						)
					}
					onClick={() => {
						if (sending) return;
						if (blockedReason !== undefined) {
							onBlocked(blockedReason);
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
