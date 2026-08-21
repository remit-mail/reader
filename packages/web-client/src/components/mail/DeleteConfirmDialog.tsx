/**
 * The delete confirmation, worded from what the delete will actually do.
 *
 * One component for every list that deletes mail — the mailbox list, the brief
 * and Flagged — so the wording and the refusal cannot drift apart again the way
 * they did between #845 and #855.
 *
 * Three of the outcomes are not confirmations at all. When the account has no
 * Trash, or the folder it appointed is gone, the server refuses the delete
 * outright; when its folder settings could not be read reader cannot say
 * whether a delete moves the mail or erases it. All three refuse and the
 * caller's `onConfirm` is never reached directly. The first two are answered
 * in place — the affirmative control opens the appointment prompt, whose own
 * confirm appoints the folder and then runs this delete. None of them may
 * render as "this folder is not Trash".
 */
import { ConfirmDialog } from "@remit/ui";
import { useAuthProvider } from "@/auth/provider";
import { type DeleteOutcome, deleteConfirmationCopy } from "@/lib/format";
import { useRoleAppointmentPrompt } from "./RoleAppointmentPromptProvider";

interface DeleteConfirmDialogProps {
	isOpen: boolean;
	/** How many messages the pending delete covers. */
	count: number;
	outcome: DeleteOutcome;
	/** The account the appointment would be made on, when the rows share one. */
	accountId?: string;
	/** The folder reader files this account's deletes in. */
	trashFolderLabel?: string;
	/** The folder the user appointed, now gone from the mail server. */
	staleFolderLabel?: string;
	/** That folder is a name match nobody ever confirmed. */
	trashIsUnconfirmed?: boolean;
	/** A delete is already in flight, so the confirm cannot be pressed again. */
	isDeleting?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export const DeleteConfirmDialog = ({
	isOpen,
	count,
	outcome,
	accountId,
	trashFolderLabel,
	staleFolderLabel,
	trashIsUnconfirmed = false,
	isDeleting = false,
	onConfirm,
	onCancel,
}: DeleteConfirmDialogProps) => {
	const { Account } = useAuthProvider();
	const { requestAppointment } = useRoleAppointmentPrompt();
	const copy = deleteConfirmationCopy(count, outcome, {
		trashFolderLabel,
		staleFolderLabel,
		trashIsUnconfirmed,
	});

	if (outcome === "noTrash" || outcome === "staleTrash") {
		return (
			<ConfirmDialog
				isOpen={isOpen}
				{...copy}
				onConfirm={() => {
					// With no account to appoint on, the delete is issued anyway and
					// the server's own 409 opens the prompt naming the account it
					// refused for. Never a control that does nothing.
					if (!accountId) return onConfirm();
					onCancel();
					requestAppointment({
						accountId,
						role: "Trash",
						reason: outcome === "noTrash" ? "none" : "stale",
						action: { kind: "delete", count },
						staleFolderLabel,
						onAppointed: async () => onConfirm(),
					});
				}}
				onCancel={onCancel}
			/>
		);
	}
	if (outcome === "unavailable") {
		return (
			<Account
				fallback={
					<ConfirmDialog
						isOpen={isOpen}
						{...copy}
						// Nothing to sign back into on a deployment with no identity
						// system, so the way forward is the read itself.
						confirmLabel="Reload reader"
						onConfirm={() => window.location.reload()}
						onCancel={onCancel}
					/>
				}
			>
				{({ signOut }) => (
					<ConfirmDialog
						isOpen={isOpen}
						{...copy}
						onConfirm={() => signOut()}
						onCancel={onCancel}
					/>
				)}
			</Account>
		);
	}

	return (
		<ConfirmDialog
			isOpen={isOpen}
			{...copy}
			destructive
			// The confirm holds while the appointment is still arriving: the answer
			// is seconds away and it decides which of two dialogs this is.
			isBusy={isDeleting || outcome === "unknown"}
			onConfirm={onConfirm}
			onCancel={onCancel}
		/>
	);
};
