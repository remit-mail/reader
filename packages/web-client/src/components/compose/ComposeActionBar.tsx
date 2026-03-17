import { Loader2, Send, Trash2 } from "lucide-react";

interface ComposeActionBarProps {
	onSend: () => void;
	onDiscard: () => void;
	isSending: boolean;
	canSend: boolean;
}

export const ComposeActionBar = ({
	onSend,
	onDiscard,
	isSending,
	canSend,
}: ComposeActionBarProps) => (
	<div className="flex items-center justify-between px-3 py-2 border-t border-border">
		<button
			type="button"
			onClick={onSend}
			disabled={isSending || !canSend}
			className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
		>
			{isSending ? (
				<Loader2 className="size-4 animate-spin" />
			) : (
				<Send className="size-4" />
			)}
			Send
		</button>
		<button
			type="button"
			onClick={onDiscard}
			disabled={isSending}
			className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded"
			aria-label="Discard"
		>
			<Trash2 className="size-4" />
		</button>
	</div>
);
