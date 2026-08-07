import { AlertCircle, Download, Loader2, Paperclip } from "lucide-react";
import { formatByteSize } from "../lib/attachment-file.js";
import { cn } from "../lib/cn.js";

export type AttachmentDownloadState =
	| { status: "idle" }
	| { status: "downloading" }
	| { status: "failed"; title: string; detail: string; reportUrl?: string };

export interface AttachmentItem {
	attachmentId: string;
	/**
	 * The name shown and the name saved — one string for both, already reduced
	 * by `sanitizeAttachmentFilename`. Anything that displays a different name
	 * than it writes to disk is the bug this field exists to prevent.
	 */
	filename: string;
	/** Short type label derived from the MIME subtype, e.g. `PDF`. */
	typeLabel: string;
	sizeOctets: number;
	download: AttachmentDownloadState;
}

export interface AttachmentListProps {
	attachments: readonly AttachmentItem[];
	onDownload: (attachmentId: string) => void;
	/**
	 * The message is flagged on the server as carrying an attachment that none
	 * of its body parts describe. Says so rather than rendering nothing, which
	 * is indistinguishable from a broken app to someone who saw the paperclip
	 * in the list.
	 */
	hasUnlistedAttachment?: boolean;
	className?: string;
}

function DownloadFailure({
	state,
	onRetry,
}: {
	state: Extract<AttachmentDownloadState, { status: "failed" }>;
	onRetry: () => void;
}) {
	return (
		<div
			role="alert"
			data-testid="attachment-error"
			className="flex items-start gap-2 border-t border-danger/30 bg-danger-soft px-2 py-2 text-xs"
		>
			<AlertCircle
				className="mt-0.5 size-3.5 shrink-0 text-danger"
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-danger">{state.title}</p>
				<p className="mt-0.5 text-fg-muted">{state.detail}</p>
			</div>
			<div className="flex shrink-0 items-center gap-3">
				<button
					type="button"
					onClick={onRetry}
					className="font-medium text-accent hover:underline"
				>
					Try again
				</button>
				{state.reportUrl && (
					<a
						href={state.reportUrl}
						target="_blank"
						rel="noreferrer"
						className="font-medium text-accent hover:underline"
					>
						Report this
					</a>
				)}
			</div>
		</div>
	);
}

/**
 * The attachments carried by an open message: what each one is, how big it is,
 * and a control that saves it.
 *
 * Every row is a real button. The paperclip in the section heading is the only
 * glyph here and it is labelled as decoration — a paperclip that looks
 * pressable and is not reads as a broken download, which is the failure this
 * list replaces (#683).
 */
export function AttachmentList({
	attachments,
	onDownload,
	hasUnlistedAttachment = false,
	className,
}: AttachmentListProps) {
	if (attachments.length === 0 && !hasUnlistedAttachment) return null;

	return (
		<section
			aria-label="Attachments"
			data-testid="attachment-list"
			className={cn("space-y-1.5", className)}
		>
			<h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				<Paperclip className="size-3" aria-hidden />
				{attachments.length === 0
					? "Attachment"
					: attachments.length === 1
						? "1 attachment"
						: `${attachments.length} attachments`}
			</h3>

			{attachments.length > 0 && (
				<ul className="overflow-hidden rounded-sm border border-line bg-surface">
					{attachments.map((attachment) => {
						const isDownloading = attachment.download.status === "downloading";
						return (
							<li
								key={attachment.attachmentId}
								className="border-t border-line first:border-t-0"
							>
								<button
									type="button"
									onClick={() => onDownload(attachment.attachmentId)}
									disabled={isDownloading}
									data-testid="attachment-download"
									aria-label={`Download ${attachment.filename}`}
									className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-surface-sunken disabled:cursor-progress disabled:opacity-60"
								>
									<span className="min-w-0 flex-1">
										{/* <bdi> isolates the name's own direction so a
										    right-to-left filename cannot reorder the label
										    around it. */}
										<bdi
											className="block truncate text-sm text-fg"
											title={attachment.filename}
										>
											{attachment.filename}
										</bdi>
										<span className="block truncate text-2xs text-fg-subtle">
											{attachment.typeLabel} ·{" "}
											{formatByteSize(attachment.sizeOctets)}
										</span>
									</span>
									{isDownloading ? (
										<Loader2
											className="size-4 shrink-0 animate-spin text-fg-subtle"
											aria-hidden
										/>
									) : (
										<Download
											className="size-4 shrink-0 text-fg-subtle"
											aria-hidden
										/>
									)}
								</button>
								{attachment.download.status === "failed" && (
									<DownloadFailure
										state={attachment.download}
										onRetry={() => onDownload(attachment.attachmentId)}
									/>
								)}
							</li>
						);
					})}
				</ul>
			)}

			{hasUnlistedAttachment && (
				<p
					role="alert"
					data-testid="attachment-unlisted"
					className="rounded-sm border border-line bg-surface px-2 py-2 text-xs text-fg-muted"
				>
					The mail server says this message carries an attachment, but none of
					its parts describe one. Re-sync the account from Settings; if the
					attachment still does not appear, the message is worth reporting.
				</p>
			)}
		</section>
	);
}
