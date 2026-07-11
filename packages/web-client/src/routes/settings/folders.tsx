import {
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
	folderRoleOperationsAppointFolderRoleMutation,
	mailboxDetailOperationsRenameMailboxMutation,
	mailboxOperationsListMailboxesOptions,
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	type CandidateFolder,
	type FolderRole,
	RoleAppointmentList,
	SettingsShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import {
	CANONICAL_TO_NAV_ROLE,
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
			<strong className="text-fg">Display name</strong> renames the appointed
			folder for the sidebar. Leave it blank to use the role's canonical name.
		</p>
	</div>
);

/** One account's folder roles, fed to the kit list. Owns its own queries + mutations. */
function AccountFolderRoles({
	account,
}: {
	account: RemitImapAccountResponse;
}) {
	const queryClient = useQueryClient();
	const accountId = account.accountId;

	const { data, isPending, isError, error, refetch } = useQuery(
		mailboxOperationsListMailboxesOptions({ path: { accountId } }),
	);

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

	const folders: CandidateFolder[] = data.items.map((mailbox) => ({
		mailboxId: mailbox.mailboxId,
		providerPath: mailbox.fullPath,
		messageCount: mailbox.messageCount,
	}));

	const appointments: Record<string, string | null> = {};
	for (const appointment of account.folderAppointments) {
		const role = CANONICAL_TO_NAV_ROLE[appointment.role];
		if (role) appointments[role] = appointment.mailboxId ?? null;
	}

	const displayNames: Record<string, string> = {};
	for (const mailbox of data.items) {
		if (mailbox.displayNameOverride) {
			displayNames[mailbox.mailboxId] = mailbox.displayNameOverride;
		}
	}

	return (
		<div className="space-y-2">
			{(appointMutation.isError || renameMutation.isError) && (
				<Banner tone="danger" variant="soft">
					Couldn't save that change. Please try again.
				</Banner>
			)}
			<RoleAppointmentList
				accountEmail={account.email}
				folders={folders}
				appointments={appointments}
				displayNames={displayNames}
				onAppoint={handleAppoint}
				onRename={handleRename}
			/>
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
						<AccountFolderRoles key={account.accountId} account={account} />
					))}
				</div>
			)}
		</SettingsShell>
	);
}
