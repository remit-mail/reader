import { Banner, Button, ConfirmDialog } from "@remit/ui";
import { Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { FolderRoleRefusalReason } from "@/components/ui/folder-role-refusal";
import { deleteConfirmationCopy, formatNumber } from "@/lib/format";

const quantified = (count: number): string =>
	count === 1 ? "1 message" : `${formatNumber(count)} messages`;

export interface EmptyTrashConfirmCopy {
	title: string;
	description: string;
	confirmLabel: string;
}

/** The confirmation the button opens, worded for an expunge. */
export const emptyTrashConfirmCopy = (
	count: number,
): EmptyTrashConfirmCopy => ({
	title: "Empty Trash?",
	description: `${quantified(count)} ${count === 1 ? "is" : "are"} erased from the mail server and cannot be restored.`,
	confirmLabel: "Empty Trash",
});

export interface EmptyTrashRefusalCopy {
	headline: string;
	body: string;
	actionLabel: string;
}

export interface EmptyTrashRefusalContext {
	/** The folder reader guessed, for `unconfirmed`. */
	trashFolderLabel?: string;
	/** The folder that vanished, for `stale`. */
	staleFolderLabel?: string;
}

/**
 * What the strip says when the server refused. `unconfirmed` borrows
 * `deleteConfirmationCopy`'s words so the dialog and this strip cannot drift
 * apart on the one refusal both can raise (#887 F4).
 */
export const emptyTrashRefusalCopy = (
	reason: FolderRoleRefusalReason,
	context: EmptyTrashRefusalContext = {},
): EmptyTrashRefusalCopy => {
	const { trashFolderLabel, staleFolderLabel } = context;

	if (reason === "unconfirmed") {
		const copy = deleteConfirmationCopy(0, "unconfirmed", { trashFolderLabel });
		return {
			headline: copy.title,
			body: copy.description,
			actionLabel: copy.confirmLabel,
		};
	}
	if (reason === "stale") {
		return {
			headline: "Nothing was emptied.",
			body: staleFolderLabel
				? `The folder you chose for Trash — ${staleFolderLabel} — is gone from the mail server.`
				: "The folder you chose for Trash is gone from the mail server.",
			actionLabel: "Pick another folder",
		};
	}
	return {
		headline: "Nothing was emptied.",
		body: "No folder on this account is set as Trash.",
		actionLabel: "Pick a folder",
	};
};

export interface EmptyTrashBarProps extends EmptyTrashRefusalContext {
	/** Messages the open Trash folder holds. */
	messageCount: number;
	isEmptying: boolean;
	/** The service's own count, from the run that just finished. */
	deletedCount?: number;
	/** The reason the server refused, kept until the user acts on it. */
	refusalReason?: FolderRoleRefusalReason;
	onEmpty: () => void;
	/** Opens the appointment prompt for the standing refusal. */
	onRepair: () => void;
	children: ReactNode;
}

/**
 * The Empty Trash strip above the Trash folder's list, and the refusals the
 * server answers it with (#847). The button always acts — it is never
 * pre-refused from what the client thinks the appointment is, because the 409
 * is the authority and a warning over a folder nobody has tried to empty is
 * noise.
 */
export function EmptyTrashBar({
	messageCount,
	isEmptying,
	deletedCount,
	refusalReason,
	trashFolderLabel,
	staleFolderLabel,
	onEmpty,
	onRepair,
	children,
}: EmptyTrashBarProps) {
	const [confirming, setConfirming] = useState(false);

	// The folder is emptied and nothing was refused: there is no verb left to
	// offer. A standing refusal or a report of what went outlives the rows,
	// so the user is never left to guess what the press did.
	if (
		messageCount < 1 &&
		refusalReason === undefined &&
		deletedCount === undefined
	)
		return <>{children}</>;

	const refusal = refusalReason
		? emptyTrashRefusalCopy(refusalReason, {
				trashFolderLabel,
				staleFolderLabel,
			})
		: undefined;
	const confirm = emptyTrashConfirmCopy(messageCount);

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div className="shrink-0 px-row-inset pt-2">
				<div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2">
					<div className="flex items-center justify-end gap-2">
						{deletedCount !== undefined && (
							<p className="mr-auto text-2xs text-fg-subtle" role="status">
								{`${quantified(deletedCount)} erased from the mail server.`}
							</p>
						)}
						<Button
							variant="ghost"
							size="sm"
							icon={<Trash2 className="size-3.5" aria-hidden />}
							disabled={isEmptying || messageCount < 1}
							aria-busy={isEmptying}
							onClick={() => setConfirming(true)}
						>
							{isEmptying ? "Emptying…" : "Empty Trash"}
						</Button>
					</div>
					{refusal && (
						<Banner tone="warning" variant="soft">
							<div className="flex flex-col gap-2">
								<p className="font-semibold text-fg">{refusal.headline}</p>
								<p className="text-sm">{refusal.body}</p>
								<Button
									variant="primary"
									size="sm"
									className="self-start"
									onClick={onRepair}
								>
									{refusal.actionLabel}
								</Button>
							</div>
						</Banner>
					)}
				</div>
			</div>
			<div className="min-h-0 flex-1">{children}</div>
			<ConfirmDialog
				isOpen={confirming}
				title={confirm.title}
				description={confirm.description}
				confirmLabel={confirm.confirmLabel}
				destructive
				isBusy={isEmptying}
				onConfirm={() => {
					setConfirming(false);
					onEmpty();
				}}
				onCancel={() => setConfirming(false)}
			/>
		</div>
	);
}
