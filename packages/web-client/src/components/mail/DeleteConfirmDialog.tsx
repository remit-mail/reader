/**
 * The delete confirmation, worded from what the delete will actually do.
 *
 * One component for every list that deletes mail — the mailbox list, the brief
 * and Flagged — so the wording and the refusal cannot drift apart again the way
 * they did between #845 and #855.
 *
 * Two of the outcomes are not confirmations at all. When the account appoints
 * no Trash the server refuses the delete outright, and when its folder settings
 * could not be read reader cannot say whether a delete moves the mail or erases
 * it. Both refuse: the affirmative control carries the remedy the copy names —
 * folder settings, or signing back in — and the caller's `onConfirm` is never
 * reached. Neither may render as "this folder is not Trash".
 */
import { ConfirmDialog } from "@remit/ui";
import { useAuthProvider } from "@/auth/provider";
import { type DeleteOutcome, deleteConfirmationCopy } from "@/lib/format";

/** Where a missing Trash appointment is made — the remedy the copy names. */
const FOLDER_SETTINGS_PATH = "/settings/folders";

interface DeleteConfirmDialogProps {
	isOpen: boolean;
	/** How many messages the pending delete covers. */
	count: number;
	outcome: DeleteOutcome;
	/** A delete is already in flight, so the confirm cannot be pressed again. */
	isDeleting?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export const DeleteConfirmDialog = ({
	isOpen,
	count,
	outcome,
	isDeleting = false,
	onConfirm,
	onCancel,
}: DeleteConfirmDialogProps) => {
	const { Account } = useAuthProvider();
	const copy = deleteConfirmationCopy(count, outcome);

	if (outcome === "noTrash") {
		return (
			<ConfirmDialog
				isOpen={isOpen}
				{...copy}
				onConfirm={() => {
					window.location.assign(FOLDER_SETTINGS_PATH);
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
