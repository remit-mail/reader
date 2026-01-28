import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { Link } from "@tanstack/react-router";
import { Check, Paperclip } from "lucide-react";
import type { MouseEvent } from "react";
import { formatEmailDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MessageListItemProps {
	thread: RemitImapThreadMessageResponse;
	mailboxId: string;
	isSelected: boolean;
	isChecked: boolean;
	onToggleCheck: (id: string) => void;
	messageCount?: number;
}

const truncateSnippet = (snippet: string, maxLength = 60): string => {
	if (snippet.length <= maxLength) return snippet;
	return `${snippet.slice(0, maxLength).trimEnd()}...`;
};

export const MessageListItem = ({
	thread,
	mailboxId,
	isSelected,
	isChecked,
	onToggleCheck,
	messageCount,
}: MessageListItemProps) => {
	const participants = thread.fromName || thread.fromEmail || "Unknown";
	const date = formatEmailDate(thread.sentDate);
	const subject = thread.subject || "(No subject)";
	const displaySubject =
		messageCount && messageCount > 1 ? `${subject} (${messageCount})` : subject;
	const snippet = thread.snippet ? truncateSnippet(thread.snippet) : "";

	const handleCheckboxClick = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onToggleCheck(thread.messageId);
	};

	return (
		<Link
			to="/mail/$mailboxId"
			params={{ mailboxId }}
			search={(prev) => ({ ...prev, selectedMessageId: thread.messageId })}
			className={cn(
				"group block px-3 py-2.5 border-b border-border transition-colors",
				"hover:bg-accent/50",
				isSelected && "bg-accent",
				isChecked && "bg-primary/10",
			)}
		>
			{/* Row 1: Checkbox/Unread dot + Participants + Date */}
			<div className="flex items-center gap-2 mb-1">
				{/* Checkbox - shows on hover or when checked, replaces unread dot */}
				<button
					type="button"
					onClick={handleCheckboxClick}
					className={cn(
						"w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-all",
						isChecked
							? "bg-primary border-primary text-primary-foreground"
							: "border-muted-foreground/40 opacity-0 group-hover:opacity-100",
						isChecked && "opacity-100",
					)}
					aria-label={isChecked ? "Deselect message" : "Select message"}
				>
					{isChecked && <Check className="size-3" />}
				</button>
				{/* Unread indicator - hidden when checkbox is visible */}
				<span
					className={cn(
						"w-2 h-2 rounded-full shrink-0 -ml-3 transition-opacity",
						!thread.isRead ? "bg-blue-500" : "bg-transparent",
						"group-hover:opacity-0",
						isChecked && "opacity-0",
					)}
				/>
				<span className="text-sm truncate flex-1 text-foreground">
					{participants}
				</span>
				<span className="text-xs text-muted-foreground shrink-0">{date}</span>
			</div>

			{/* Row 2: Subject + Message count + Attachment icon */}
			<div className="flex items-center gap-2 pl-4 mb-1">
				<span
					className={cn(
						"text-sm truncate flex-1",
						!thread.isRead ? "text-foreground" : "text-muted-foreground",
					)}
				>
					{displaySubject}
				</span>
				{thread.hasAttachment && (
					<Paperclip
						className="size-3.5 shrink-0 text-muted-foreground"
						aria-label="Has attachments"
					/>
				)}
			</div>

			{/* Row 3: Snippet preview */}
			{snippet && (
				<div className="text-xs text-muted-foreground pl-4 line-clamp-1">
					{snippet}
				</div>
			)}
		</Link>
	);
};
