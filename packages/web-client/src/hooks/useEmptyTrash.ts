/**
 * Emptying an account's Trash, and the refusal the server answers it with.
 *
 * The press always reaches the server (#847): the client's `/config` is a read
 * that can be stale, so a folder-role refusal is the server's to make, and the
 * 409 is the only authority the surface listens to. On that refusal the strip
 * states it in place and the repair opens the appointment prompt, which replays
 * the empty once a folder is confirmed (#887 D16 item 1).
 */
import {
	configOperationsGetConfigQueryKey,
	mailboxOperationsListMailboxesQueryKey,
	trashOperationsEmptyTrashMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useRoleAppointmentPrompt } from "@/components/mail/RoleAppointmentPromptProvider";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import {
	type FolderRoleRefusal,
	isFolderRoleRefusal,
} from "@/components/ui/folder-role-refusal";
import {
	invalidateThreadListQueries,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";

interface UseEmptyTrashOptions {
	accountId: string | undefined;
	/** The open Trash mailbox, whose listing the empty invalidates. */
	mailboxId: string;
}

export interface EmptyTrashState {
	emptyTrash: () => void;
	isEmptying: boolean;
	/** What the last finished run reported, straight from the service. */
	deletedCount: number | undefined;
	refusal: FolderRoleRefusal | undefined;
	repair: () => void;
}

export const useEmptyTrash = ({
	accountId,
	mailboxId,
}: UseEmptyTrashOptions): EmptyTrashState => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();
	const { requestAppointment } = useRoleAppointmentPrompt();
	const [deletedCount, setDeletedCount] = useState<number>();
	const [refusal, setRefusal] = useState<FolderRoleRefusal>();

	const { mutateAsync, isPending } = useMutation({
		...trashOperationsEmptyTrashMutation(),
		onSuccess: (data) => {
			setRefusal(undefined);
			// The service's count, never a local tally. A second press re-marks the
			// same rows and reports N again — that is what the folder still holds,
			// and reporting 0 over an expunge is the failure #887 is about.
			setDeletedCount(data.deletedCount);
		},
		onError: (error) => {
			const refused = isFolderRoleRefusal(error);
			if (!refused) {
				pushError({
					title: "Couldn't empty Trash",
					detail: formatErrorDetail(error),
					error,
				});
				return;
			}
			setRefusal(refused);
			// The server's resolution outranks the one on screen, so re-read it:
			// that is where the name of a folder the appointment lost comes from.
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
		},
		onSettled: () => {
			invalidateThreadListQueries(
				queryClient,
				threadListCacheKeys([mailboxId]),
			);
			if (!accountId) return;
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
		},
	});

	// `onError` above has already stated the failure; the rejection reaching the
	// caller would only report it a second time.
	const run = useCallback((): Promise<void> => {
		if (!accountId) return Promise.resolve();
		setDeletedCount(undefined);
		return mutateAsync({ path: { accountId } }).then(
			() => {},
			() => {},
		);
	}, [accountId, mutateAsync]);

	const emptyTrash = useCallback(() => {
		void run();
	}, [run]);

	const repair = useCallback(() => {
		if (!refusal) return;
		requestAppointment({
			accountId: refusal.accountId,
			role: refusal.role,
			reason: refusal.reason,
			action: { kind: "emptyTrash" },
			onAppointed: run,
		});
	}, [refusal, requestAppointment, run]);

	return { emptyTrash, isEmptying: isPending, deletedCount, refusal, repair };
};
