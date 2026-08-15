import { Button, cn } from "@remit/ui";
import { Undo2 } from "lucide-react";

export interface RejectedNoticeProps {
	title: string;
	sender: string;
	senderAddress: string;
	ruled: boolean;
	onRule: () => void;
	onDecline: () => void;
	onUndo: () => void;
	touch?: boolean;
}

/**
 * Rejecting one reading is a chance to stop the next twenty. The rule is
 * offered, never applied on the reader's behalf, and it is undoable while the
 * notice is still on screen. It replaces the card silently on screen, so it
 * announces itself — otherwise a reader who cannot see the column is told
 * nothing about either the drop or the offer.
 */
export function RejectedNotice({
	title,
	sender,
	senderAddress,
	ruled,
	onRule,
	onDecline,
	onUndo,
	touch,
}: RejectedNoticeProps) {
	return (
		<div
			role="status"
			className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
		>
			<p className="text-xs text-fg-muted">
				<span className="text-fg">{title}</span> dropped.
			</p>
			{ruled ? (
				<p className="text-xs text-fg">
					Nothing more will be suggested from {senderAddress}. Their mail still
					arrives as normal.
				</p>
			) : (
				<p className="text-xs text-fg-muted">
					{sender} sends mail like this often. Stop reading dates out of it?
				</p>
			)}
			<div className={cn("flex items-center gap-2", touch && "flex-wrap")}>
				{!ruled && (
					<>
						<Button
							variant="secondary"
							size={touch ? "md" : "sm"}
							onClick={onRule}
							className={cn(touch && "min-h-11")}
						>
							Never suggest from {sender}
						</Button>
						<Button
							variant="ghost"
							size={touch ? "md" : "sm"}
							onClick={onDecline}
							className={cn(touch && "min-h-11")}
						>
							Just this one
						</Button>
					</>
				)}
				<Button
					variant="ghost"
					size={touch ? "md" : "sm"}
					icon={<Undo2 className="size-3.5" />}
					onClick={onUndo}
					className={cn(touch && "min-h-11")}
				>
					Undo
				</Button>
			</div>
		</div>
	);
}
