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
			<span className="text-xs text-muted-foreground animate-pulse">
				Saving...
			</span>
		);
	}
	if (status === "saved") {
		return <span className="text-xs text-muted-foreground">Draft saved</span>;
	}
	if (status === "error") {
		return <span className="text-xs text-destructive">Save failed</span>;
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
	<div className="flex items-center justify-between px-3 py-2 border-t border-border">
		<div className="flex items-center gap-3">
			<button
				type="button"
				onClick={onSend}
				disabled={isSending || !canSend}
				title={!canSend && disabledReason ? disabledReason : undefined}
				aria-label={
					!canSend && disabledReason ? `Send (${disabledReason})` : undefined
				}
				className="inline-flex items-center gap-2 px-4 py-1.5 max-sm:min-h-11 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
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
			className="p-2 max-sm:min-h-11 max-sm:min-w-11 inline-flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors rounded"
			aria-label="Discard"
		>
			<Trash2 className="size-4" />
		</button>
	</div>
);
