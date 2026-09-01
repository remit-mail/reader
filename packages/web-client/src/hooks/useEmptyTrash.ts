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
import type { ConfigOperationsGetConfigResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useRoleAppointmentPrompt } from "@/components/mail/RoleAppointmentPromptProvider";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import {
	type FolderRoleRefusal,
	isFolderRoleRefusal,
} from "@/components/ui/folder-role-refusal";
import { softErrorStatuses } from "@/lib/error-classifier";
import {
	invalidateThreadListQueries,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";
import { useTrashByAccount } from "./useArchiveMailbox";

interface UseEmptyTrashOptions {
	accountId: string | undefined;
	/** The open mailbox the strip is mounted over. */
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

/**
 * What a report or a refusal is about. Both are facts about one account's
 * Trash as it resolved at the time, so neither may survive the mailbox or the
 * account changing under a pane that never remounts — nor a resolution
 * repaired elsewhere, which is the "or the resolution changes" the refusal
 * persists until.
 */
const scopeOf = (
	accountId: string | undefined,
	mailboxId: string,
	trashMailboxId: string | undefined,
	source: string | undefined,
): string =>
	`${accountId ?? ""}|${mailboxId}|${trashMailboxId ?? ""}|${source ?? ""}`;

interface EmptyTrashRun {
	scope: string;
	deletedCount?: number;
	refusal?: FolderRoleRefusal;
}

interface EmptyTrashContext {
	scope: string;
	/** The folder the empty was issued against, whose listing it invalidates. */
	listMailboxId: string;
}

export const useEmptyTrash = ({
	accountId,
	mailboxId,
}: UseEmptyTrashOptions): EmptyTrashState => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();
	const { requestAppointment } = useRoleAppointmentPrompt();
	const { trashByAccount } = useTrashByAccount();

	const trash = accountId ? trashByAccount.get(accountId) : undefined;
	const scope = scopeOf(accountId, mailboxId, trash?.mailboxId, trash?.source);

	const [run, setRun] = useState<EmptyTrashRun>({ scope });
	if (run.scope !== scope) setRun({ scope });
	const current = run.scope === scope ? run : undefined;

	/**
	 * The Trash as `/config` reads *now*, straight from the cache. After a
	 * repair the appointment names a different folder, and the replay must
	 * invalidate that folder's listing rather than the one this pane opened —
	 * a render has not necessarily flushed by the time the replay is called.
	 */
	const listMailboxIdNow = useCallback((): string => {
		const config = queryClient.getQueryData<ConfigOperationsGetConfigResponse>(
			configOperationsGetConfigQueryKey(),
		);
		const account = config?.accounts.find((one) => one.accountId === accountId);
		const appointed = account?.folderAppointments.find(
			(one) => one.role === "Trash",
		)?.mailboxId;
		return appointed ?? mailboxId;
	}, [queryClient, accountId, mailboxId]);

	// What the run in flight is about, for the same reason: a press on one
	// folder must not read as a press on the next one the pane opens.
	const inFlight = useRef<string>(undefined);

	const { mutateAsync, isPending } = useMutation({
		...trashOperationsEmptyTrashMutation(),
		// The refusal is rendered in the pane, so it must not also take the whole
		// screen. Only 409 — every other status is still the fatal page's (#1059).
		meta: softErrorStatuses(409),
		onMutate: (): EmptyTrashContext => {
			inFlight.current = scope;
			return { scope, listMailboxId: listMailboxIdNow() };
		},
		onSuccess: (data, _variables, context) => {
			if (context.scope !== scope) return;
			// The service's count, never a local tally. A second press re-marks the
			// same rows and reports N again — that is what the folder still holds,
			// and reporting 0 over an expunge is the failure #887 is about.
			setRun({ scope, deletedCount: data.deletedCount });
		},
		onError: (error, _variables, context) => {
			const refused = isFolderRoleRefusal(error);
			if (!refused) {
				pushError({
					title: "Couldn't empty Trash",
					detail: formatErrorDetail(error),
					error,
				});
				return;
			}
			// A refusal that outlived what it was about states somebody else's
			// problem over this folder.
			if (context?.scope !== scope) return;
			setRun({ scope, refusal: refused });
		},
		onSettled: (_data, _error, _variables, context) => {
			if (inFlight.current === context?.scope) inFlight.current = undefined;
			invalidateThreadListQueries(
				queryClient,
				threadListCacheKeys([context?.listMailboxId ?? mailboxId]),
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
	const issue = useCallback((): Promise<void> => {
		if (!accountId) return Promise.resolve();
		setRun({ scope });
		return mutateAsync({ path: { accountId } }).then(
			() => {},
			() => {},
		);
	}, [accountId, scope, mutateAsync]);

	const emptyTrash = useCallback(() => {
		void issue();
	}, [issue]);

	const repair = useCallback(() => {
		const refusal = current?.refusal;
		if (!refusal) return;
		requestAppointment({
			accountId: refusal.accountId,
			role: refusal.role,
			reason: refusal.reason,
			action: { kind: "emptyTrash" },
			onAppointed: issue,
		});
	}, [current, requestAppointment, issue]);

	return {
		emptyTrash,
		isEmptying: isPending && inFlight.current === scope,
		deletedCount: current?.deletedCount,
		refusal: current?.refusal,
		repair,
	};
};
