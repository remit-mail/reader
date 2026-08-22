import {
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
	folderRoleOperationsAppointFolderRoleMutation,
	mailboxDetailOperationsRenameMailboxMutation,
	mailboxOperationsListMailboxesOptions,
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	type CandidateFolder,
	FolderManager,
	FolderRenameDialog,
	type FolderRole,
	type ManagedFolder,
	type RoleAppointment,
	RoleAppointmentList,
	SettingsShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DeleteFolderDialog } from "@/components/settings/DeleteFolderDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { isMailboxNotSettledRefusal } from "@/components/ui/folder-role-refusal";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useFolderLabelTranslator } from "@/hooks/useFolderLabelTranslator";
import { guardFolderDeletion } from "@/lib/delete-folder";
import {
	buildMailboxRoleMap,
	CANONICAL_TO_NAV_ROLE,
	labelForMailbox,
	NAV_ROLE_TO_CANONICAL,
} from "@/lib/folder-roles";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/folders")({
	component: FoldersSettings,
});

const foldersHelp = (
	<div className="space-y-3">
		<p>
			Each canonical role — Inbox, Drafts, Sent, Archive, Spam, Trash — points
			at one of your account's real folders. Pick the one that actually holds
			the mail; the message counts tell real folders from empty look-alikes.
		</p>
		<p>
			Appointing a folder to a role here doesn't touch any other role, and
			doesn't move or rename anything on the server — it just tells Remit which
			folder to treat as e.g. "Drafts" everywhere (sidebar, unread badges, the
			compose flow).
		</p>
		<p>
			<strong className="text-fg">Your folders</strong> is the account's real
			hierarchy. Open a folder to see what's inside it, make a new one where
			you're looking, and rename or delete any of them from its row.
		</p>
	</div>
);

/** One account's folder roles and its folder hierarchy. Owns its own queries + mutations. */
function AccountFolders({ account }: { account: RemitImapAccountResponse }) {
	const queryClient = useQueryClient();
	const accountId = account.accountId;
	const translator = useFolderLabelTranslator();

	const { data, isPending, isError, error, refetch } = useQuery(
		mailboxOperationsListMailboxesOptions({ path: { accountId } }),
	);

	const { createFolderIn } = useCreateMailbox(accountId);

	const appointMutation = useMutation({
		...folderRoleOperationsAppointFolderRoleMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
		},
	});

	const renameMutation = useMutation({
		...mailboxDetailOperationsRenameMailboxMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: mailboxOperationsListMailboxesQueryKey({
					path: { accountId },
				}),
			});
		},
	});

	const [deletingMailboxId, setDeletingMailboxId] = useState<string>();
	const [renamingMailboxId, setRenamingMailboxId] = useState<string>();
	const [renameDraft, setRenameDraft] = useState("");

	const mailboxes = useMemo(() => data?.items ?? [], [data]);
	const roleMap = useMemo(
		() => buildMailboxRoleMap(account.folderAppointments),
		[account.folderAppointments],
	);

	const folders = useMemo<ManagedFolder[]>(
		() =>
			mailboxes.map((mailbox) => ({
				id: mailbox.mailboxId,
				label: labelForMailbox(
					mailbox,
					roleMap.get(mailbox.mailboxId),
					translator,
				),
				path: mailbox.fullPath,
				deleteBlockedReason: guardFolderDeletion(
					mailbox,
					mailboxes,
					account.folderAppointments,
				).message,
			})),
		[mailboxes, roleMap, translator, account.folderAppointments],
	);

	const handleAppoint = (role: FolderRole, mailboxId: string | null) => {
		appointMutation.mutate({
			path: { accountId, role: NAV_ROLE_TO_CANONICAL[role] },
			body: { mailboxId },
		});
	};

	const handleRename = (mailboxId: string, name: string) => {
		const trimmed = name.trim();
		renameMutation.mutate({
			path: { accountId, mailboxId },
			body: { displayNameOverride: trimmed === "" ? null : trimmed },
		});
	};

	if (isPending) {
		return (
			// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label on loading skeleton provides useful context for assistive tech
			<div
				className="h-24 animate-pulse rounded-sm border border-line bg-surface"
				aria-busy="true"
				aria-label={`Loading folders for ${account.email}`}
			/>
		);
	}

	if (isError) {
		return (
			<ErrorState
				variant="inline"
				title={`Couldn't load folders for ${account.email}`}
				error={error}
				onRetry={() => {
					refetch();
				}}
			/>
		);
	}

	const candidates: CandidateFolder[] = mailboxes.map((mailbox) => ({
		mailboxId: mailbox.mailboxId,
		providerPath: mailbox.fullPath,
		messageCount: mailbox.messageCount,
	}));

	const appointments: Record<string, RoleAppointment> = {};
	for (const appointment of account.folderAppointments) {
		const role = CANONICAL_TO_NAV_ROLE[appointment.role];
		if (!role) continue;
		appointments[role] = {
			mailboxId: appointment.mailboxId ?? null,
			source: appointment.source,
			staleFolderPath: appointment.staleAppointmentPath,
		};
	}

	const displayNames: Record<string, string> = {};
	for (const mailbox of mailboxes) {
		if (mailbox.displayNameOverride) {
			displayNames[mailbox.mailboxId] = mailbox.displayNameOverride;
		}
	}

	const findMailbox = (
		mailboxId: string | undefined,
	): RemitImapMailboxResponse | undefined =>
		mailboxes.find((mailbox) => mailbox.mailboxId === mailboxId);

	const renaming = findMailbox(renamingMailboxId);
	const deleting = findMailbox(deletingMailboxId);

	return (
		<div className="space-y-4">
			{(appointMutation.isError || renameMutation.isError) && (
				<Banner tone="danger" variant="soft">
					{isMailboxNotSettledRefusal(appointMutation.error)
						? "That folder is still being created on the mail server — wait for it to finish, then try again."
						: "Couldn't save that change. Please try again."}
				</Banner>
			)}
			<RoleAppointmentList
				accountEmail={account.email}
				folders={candidates}
				appointments={appointments}
				displayNames={displayNames}
				onAppoint={handleAppoint}
				onRename={handleRename}
			/>
			<section className="space-y-1.5">
				<h3 className="text-sm font-semibold text-fg">
					Your folders — {account.email}
				</h3>
				<div className="flex h-[28rem] flex-col overflow-hidden rounded-sm border border-line bg-surface">
					<FolderManager
						folders={folders}
						delimiter={mailboxes[0]?.hierarchyDelimiter ?? "/"}
						onCreateFolder={createFolderIn}
						onRename={(folder) => {
							setRenamingMailboxId(folder.id);
							setRenameDraft(
								findMailbox(folder.id)?.displayNameOverride?.trim() ?? "",
							);
						}}
						onDelete={(folder) => setDeletingMailboxId(folder.id)}
						labels={{ treeAriaLabel: `All folders for ${account.email}` }}
					/>
				</div>
			</section>
			{renaming && (
				<FolderRenameDialog
					open
					folderLabel={labelForMailbox(
						renaming,
						roleMap.get(renaming.mailboxId),
						translator,
					)}
					defaultLabel={labelForMailbox(
						{
							fullPath: renaming.fullPath,
							hierarchyDelimiter: renaming.hierarchyDelimiter,
						},
						roleMap.get(renaming.mailboxId),
						translator,
					)}
					name={renameDraft}
					onNameChange={setRenameDraft}
					pending={renameMutation.isPending}
					error={
						renameMutation.isError
							? "Couldn't save that name. Please try again."
							: undefined
					}
					onSubmit={() => {
						const trimmed = renameDraft.trim();
						renameMutation.mutate(
							{
								path: { accountId, mailboxId: renaming.mailboxId },
								body: {
									displayNameOverride: trimmed === "" ? null : trimmed,
								},
							},
							{ onSuccess: () => setRenamingMailboxId(undefined) },
						);
					}}
					onClose={() => setRenamingMailboxId(undefined)}
				/>
			)}
			{deleting && (
				<DeleteFolderDialog
					open
					accountId={accountId}
					folder={deleting}
					mailboxes={mailboxes}
					appointments={account.folderAppointments}
					onClose={() => setDeletingMailboxId(undefined)}
				/>
			)}
		</div>
	);
}

function FoldersSettings() {
	const navigate = useNavigate();
	const [helpOpen, setHelpOpen] = useState(true);

	const {
		data: config,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(configOperationsGetConfigOptions());

	const handleSelectNav = (id: string) => {
		const path = SETTINGS_ID_TO_PATH[id];
		if (path) void navigate({ to: path });
	};

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="folders"
			title="Folder roles"
			description="Appoint which real folder fills each canonical role, per account."
			help={foldersHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
			onSelect={handleSelectNav}
			onBackToMail={() => void navigate({ to: "/mail" })}
		>
			{isPending ? (
				// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label on loading skeleton provides useful context for assistive tech
				<div
					className="h-24 animate-pulse rounded-sm border border-line bg-surface"
					aria-busy="true"
					aria-label="Loading accounts"
				/>
			) : isError ? (
				<ErrorState
					title="Couldn't load accounts"
					error={error}
					onRetry={() => {
						refetch();
					}}
				/>
			) : config.accounts.length === 0 ? (
				<p className="py-12 text-sm text-fg-muted">No accounts configured.</p>
			) : (
				<div className="space-y-8">
					{config.accounts.map((account) => (
						<AccountFolders key={account.accountId} account={account} />
					))}
				</div>
			)}
		</SettingsShell>
	);
}
