import {
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
	folderRoleOperationsAppointFolderRoleMutation,
	mailboxOperationsListMailboxesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapCanonicalMailboxRole } from "@remit/api-http-client/types.gen.ts";
import {
	type PromptAction,
	type PromptPhase,
	type PromptReason,
	RoleAppointmentPrompt,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { isMailboxNotSettledRefusal } from "@/components/ui/folder-role-refusal";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useFolderLabelTranslator } from "@/hooks/useFolderLabelTranslator";
import { buildMailboxRoleMap, labelForMailbox } from "@/lib/folder-roles";
import { buildMoveOptions, folderDelimiter } from "@/lib/move-options";

export interface AppointmentRequest {
	accountId: string;
	role: RemitImapCanonicalMailboxRole;
	/** From the refusal that opened this, never re-derived from live state. */
	reason: PromptReason;
	action: PromptAction;
	/** `unconfirmed`: the folder reader guessed. Filled from `/config` if absent. */
	trashFolderLabel?: string;
	/** `stale`: the folder that vanished. Filled from `/config` if absent. */
	staleFolderLabel?: string;
	guessedMailboxId?: string;
	/**
	 * Re-issues the caller's own action once the folder is appointed. The caller
	 * owns it so its optimistic and cache machinery is not duplicated here — and
	 * so a chunked run replays the whole original selection, not the chunk the
	 * server happened to refuse.
	 */
	onAppointed: () => Promise<void>;
}

interface RoleAppointmentPromptContextValue {
	requestAppointment: (request: AppointmentRequest) => void;
}

const RoleAppointmentPromptContext = createContext<
	RoleAppointmentPromptContextValue | undefined
>(undefined);

/** The appointment write failed, so nothing after it may run. */
const APPOINT_FAILED = Symbol("appoint-failed");

/**
 * The appointment ceremony, mounted once and reached from either entry path.
 * It owns both writes' order (D16 item 1): appoint, wait for the 200,
 * invalidate and await `/config`, then re-issue the action that was refused.
 */
export const RoleAppointmentPromptProvider = ({
	children,
}: {
	children: ReactNode;
}) => {
	const queryClient = useQueryClient();
	const translator = useFolderLabelTranslator();
	const [request, setRequest] = useState<AppointmentRequest | null>(null);
	const [selectedId, setSelectedId] = useState<string>();
	const [phase, setPhase] = useState<PromptPhase>({ kind: "choosing" });

	const accountId = request?.accountId;
	// Nothing is asked of the server until an action is actually refused: this
	// provider is mounted at the root, so an ungated read would put a request
	// behind every screen that never opens a prompt.
	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
		enabled: !!accountId,
	});
	const { data: mailboxData } = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: accountId ?? "" },
		}),
		enabled: !!accountId,
	});
	const { createFolderIn } = useCreateMailbox(accountId);
	const appointMutation = useMutation(
		folderRoleOperationsAppointFolderRoleMutation(),
	);

	const account = config?.accounts.find((one) => one.accountId === accountId);
	const mailboxes = useMemo(() => mailboxData?.items ?? [], [mailboxData]);
	const appointments = useMemo(
		() => account?.folderAppointments ?? [],
		[account],
	);

	const folders = useMemo(
		() =>
			buildMoveOptions({
				mailboxes,
				folderAppointments: appointments,
				translator,
			}),
		[mailboxes, appointments, translator],
	);

	const trash = appointments.find(
		(appointment) => appointment.role === request?.role,
	);
	const guessedMailboxId = request?.guessedMailboxId ?? trash?.mailboxId;
	const guessed = mailboxes.find(
		(mailbox) => mailbox.mailboxId === guessedMailboxId,
	);
	const trashFolderLabel =
		request?.trashFolderLabel ??
		(guessed
			? labelForMailbox(
					guessed,
					buildMailboxRoleMap(appointments).get(guessed.mailboxId),
					translator,
				)
			: undefined);

	// Written synchronously so a refusal raised during the replay is already the
	// live request by the time the finished ceremony tries to tear itself down.
	const liveRequest = useRef<AppointmentRequest | null>(null);

	const close = useCallback(() => {
		liveRequest.current = null;
		setRequest(null);
		setSelectedId(undefined);
		setPhase({ kind: "choosing" });
	}, []);

	const requestAppointment = useCallback((next: AppointmentRequest) => {
		liveRequest.current = next;
		setRequest(next);
		setPhase({ kind: "choosing" });
		// Only a confirmation of an existing guess starts with something chosen:
		// the common case is one tap, and the tree is there to correct it.
		setSelectedId(
			next.reason === "unconfirmed" ? next.guessedMailboxId : undefined,
		);
	}, []);

	/**
	 * Tear the ceremony down only if it is still the one on screen. The replay
	 * can be refused a second time — a selection spanning two accounts that both
	 * lack a Trash — and that refusal opens its own prompt before this one
	 * finishes. Closing unconditionally would destroy it in the same tick, with
	 * the rows rolled back and no account of why.
	 */
	const closeFinished = useCallback(
		(finished: AppointmentRequest) => {
			if (liveRequest.current !== finished) return;
			close();
		},
		[close],
	);

	const handleConfirm = useCallback(
		(mailboxId: string) => {
			if (!request) return;
			setPhase({ kind: "appointing" });
			void appointMutation
				.mutateAsync({
					path: { accountId: request.accountId, role: request.role },
					body: { mailboxId },
				})
				.catch((error: unknown) => {
					setPhase({
						kind: "appoint-failed",
						cause: isMailboxNotSettledRefusal(error)
							? "mailbox-pending"
							: "generic",
					});
					return APPOINT_FAILED;
				})
				.then(async (result) => {
					if (result === APPOINT_FAILED) return;
					await queryClient.invalidateQueries({
						queryKey: configOperationsGetConfigQueryKey(),
					});
					setPhase({ kind: "acting" });
					await request.onAppointed();
					closeFinished(request);
				})
				// The replay is the caller's mutation and banners its own failure;
				// leaving the ceremony up over it would ask for the folder twice.
				.catch(() => closeFinished(request));
		},
		[request, appointMutation, queryClient, closeFinished],
	);

	const value = useMemo(() => ({ requestAppointment }), [requestAppointment]);

	return (
		<RoleAppointmentPromptContext.Provider value={value}>
			{children}
			{request && (
				<RoleAppointmentPrompt
					open
					reason={request.reason}
					action={request.action}
					folders={folders}
					delimiter={folderDelimiter(mailboxes)}
					trashFolderLabel={trashFolderLabel}
					staleFolderLabel={
						request.staleFolderLabel ?? trash?.staleAppointmentPath
					}
					accountEmail={
						(config?.accounts.length ?? 0) > 1 ? account?.email : undefined
					}
					phase={phase}
					selectedId={selectedId}
					onSelect={setSelectedId}
					onCreateFolder={createFolderIn}
					onConfirm={handleConfirm}
					onCancel={close}
				/>
			)}
		</RoleAppointmentPromptContext.Provider>
	);
};

/**
 * Opens the appointment ceremony for a refused action. The caller keeps the
 * replay, so the action that was stopped is the action that runs.
 */
export const useRoleAppointmentPrompt =
	(): RoleAppointmentPromptContextValue => {
		const context = useContext(RoleAppointmentPromptContext);
		if (!context) {
			throw new Error(
				"useRoleAppointmentPrompt must be used within a RoleAppointmentPromptProvider",
			);
		}
		return context;
	};
