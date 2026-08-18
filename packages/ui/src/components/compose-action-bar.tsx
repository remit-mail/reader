import { Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "./button.js";

/**
 * What the draft is doing, and — when it is not being saved — the sentence that
 * says why. Built the same way as `ComposeSendState` and for the same reason:
 * a composer holding text it is not persisting must never be able to say so
 * without saying what is missing. The bare "idle" this replaces rendered
 * nothing at all, so a message that could not be saved yet looked identical to
 * one that had nothing to save.
 */
export type ComposeSaveState =
	| { status: "idle" }
	| { status: "saving" }
	| { status: "saved" }
	| { status: "error" }
	| { status: "unsaved"; reason: string };

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
	save?: ComposeSaveState;
}

const SaveStateIndicator = ({ save }: { save: ComposeSaveState }) => {
	if (save.status === "saving") {
		return (
			<output className="animate-pulse text-xs text-fg-muted">Saving...</output>
		);
	}
	if (save.status === "saved") {
		return <output className="text-xs text-fg-muted">Draft saved</output>;
	}
	if (save.status === "error") {
		return <output className="text-xs text-danger">Save failed</output>;
	}
	if (save.status === "unsaved") {
		return (
			<output className="truncate text-xs text-warning">{save.reason}</output>
		);
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
	save = { status: "idle" },
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
				<SaveStateIndicator save={save} />
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
