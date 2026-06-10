import { Loader2, Send, Trash2 } from "lucide-react";
import type { SaveStatus } from "../../hooks/useSaveDraft";

interface ComposeActionBarProps {
	onSend: () => void;
	onDiscard: () => void;
	isSending: boolean;
	canSend: boolean;
	saveStatus?: SaveStatus;
	disabledReason?: string;
}

const SaveStatusIndicator = ({ status }: { status: SaveStatus }) => {
	if (status === "saving") {
		return (
			<span className="text-xs text-fg-muted animate-pulse">Saving...</span>
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

export const ComposeActionBar = ({
	onSend,
	onDiscard,
	isSending,
	canSend,
	saveStatus = "idle",
	disabledReason,
}: ComposeActionBarProps) => (
	<div className="flex items-center justify-between px-3 py-2 border-t border-line">
		<div className="flex items-center gap-3">
			<button
				type="button"
				onClick={onSend}
				disabled={isSending || !canSend}
				title={!canSend && disabledReason ? disabledReason : undefined}
				aria-label={
					!canSend && disabledReason ? `Send (${disabledReason})` : undefined
				}
				className="inline-flex items-center gap-2 px-4 py-1.5 min-h-11 text-sm font-medium rounded-full bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 transition-colors"
			>
				{isSending ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Send className="size-4" />
				)}
				Send
			</button>
			<SaveStatusIndicator status={saveStatus} />
		</div>
		<button
			type="button"
			onClick={onDiscard}
			disabled={isSending}
			className="p-2 min-h-11 min-w-11 inline-flex items-center justify-center text-fg-muted hover:text-danger transition-colors rounded"
			aria-label="Discard"
		>
			<Trash2 className="size-4" />
		</button>
	</div>
);
