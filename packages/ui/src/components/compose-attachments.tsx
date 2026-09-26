import { AlertCircle, Loader2, Paperclip, X } from "lucide-react";
import { formatByteSize } from "../lib/attachment-file.js";
import { cn } from "../lib/cn.js";

/**
 * Where one file on a draft stands. A refusal cannot be built without the
 * sentence that says why, and says whether pressing again can change it: a
 * file over the cap stays over the cap, a dropped connection may not.
 */
export type ComposeAttachmentState =
	| { status: "uploading" }
	| { status: "attached" }
	| { status: "failed"; reason: string; retryable: boolean };

export interface ComposeAttachmentItem {
	key: string;
	filename: string;
	sizeBytes: number;
	state: ComposeAttachmentState;
}

export interface ComposeAttachmentsProps {
	items: readonly ComposeAttachmentItem[];
	onRemove: (key: string) => void;
	onRetry: (key: string) => void;
	className?: string;
}

const StateIcon = ({ state }: { state: ComposeAttachmentState }) => {
	if (state.status === "uploading") {
		return (
			<Loader2
				className="size-4 shrink-0 animate-spin text-fg-subtle"
				aria-hidden
			/>
		);
	}
	if (state.status === "failed") {
		return <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden />;
	}
	return <Paperclip className="size-4 shrink-0 text-fg-subtle" aria-hidden />;
};

/**
 * The files a message is going out with, while it is being written: each one's
 * name and size, whether it has arrived, and a control that takes it off.
 * Nothing is dropped quietly — a file the server refused stays in the list with
 * the reason until it is removed.
 */
export function ComposeAttachments({
	items,
	onRemove,
	onRetry,
	className,
}: ComposeAttachmentsProps) {
	if (items.length === 0) return null;

	return (
		<ul
			aria-label="Attached files"
			data-testid="compose-attachments"
			className={cn("flex flex-col gap-1 px-3 py-2", className)}
		>
			{items.map((item) => (
				<li
					key={item.key}
					data-testid="compose-attachment"
					data-state={item.state.status}
					className={cn(
						"rounded-sm border bg-surface",
						item.state.status === "failed" ? "border-danger/40" : "border-line",
					)}
				>
					<div className="flex items-center gap-2 px-2 py-1.5">
						<StateIcon state={item.state} />
						<span className="min-w-0 flex-1">
							<bdi
								className="block truncate text-sm text-fg"
								title={item.filename}
							>
								{item.filename}
							</bdi>
							<span className="block text-2xs text-fg-subtle">
								{formatByteSize(item.sizeBytes)}
								{item.state.status === "uploading" ? " · Uploading…" : ""}
							</span>
						</span>
						{item.state.status === "failed" && item.state.retryable && (
							<button
								type="button"
								onClick={() => onRetry(item.key)}
								className="text-xs font-medium text-accent hover:underline"
							>
								Try again
							</button>
						)}
						<button
							type="button"
							aria-label={`Remove ${item.filename}`}
							onClick={() => onRemove(item.key)}
							className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken hover:text-fg"
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>
					{item.state.status === "failed" && (
						<p
							role="alert"
							data-testid="compose-attachment-error"
							className="border-t border-danger/30 bg-danger-soft px-2 py-1.5 text-xs text-danger"
						>
							{item.state.reason}
						</p>
					)}
				</li>
			))}
		</ul>
	);
}
