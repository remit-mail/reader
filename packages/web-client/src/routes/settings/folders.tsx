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
	Button,
	type CandidateFolder,
	type FolderRole,
	Input,
	RoleAppointmentList,
	Select,
	SettingsShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import {
	CANONICAL_TO_NAV_ROLE,
	getMailboxDisplayName,
	NAV_ROLE_TO_CANONICAL,
} from "@/lib/folder-roles";
import {
	composeFolderPath,
	type FolderTarget,
	validateNewFolderName,
} from "@/lib/new-folder";
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

/**
 * Create a folder for one account. A name, an optional parent to nest under,
 * and a create button. The new folder is queued on the server with a pending
 * sync and appears in the list below once it refetches.
 */
function NewFolder({
	accountId,
	mailboxes,
}: {
	accountId: string;
	mailboxes: RemitImapMailboxResponse[];
}) {
	const { mutation } = useCreateMailbox(accountId);
	const [name, setName] = useState("");
	const [parentId, setParentId] = useState("");
	const [validationError, setValidationError] = useState<string>();

	const accountDelimiter = mailboxes[0]?.hierarchyDelimiter ?? "/";
	const parentMailbox = mailboxes.find((box) => box.mailboxId === parentId);
	const parent: FolderTarget | undefined = parentMailbox
		? {
				fullPath: parentMailbox.fullPath,
				hierarchyDelimiter: parentMailbox.hierarchyDelimiter,
			}
		: undefined;
	const delimiter = parent?.hierarchyDelimiter ?? accountDelimiter;

	const handleCreate = () => {
		const problem = validateNewFolderName({
			name,
			delimiter,
			parent,
			existingPaths: mailboxes.map((box) => box.fullPath),
		});
		if (problem) {
			setValidationError(problem);
			return;
		}
		setValidationError(undefined);
		mutation.mutate(
			{
				path: { accountId },
				body: {
					fullPath: composeFolderPath(name, parent),
					namespaceType: "personal",
				},
			},
			{
				onSuccess: () => {
					setName("");
					setParentId("");
				},
			},
		);
	};

	return (
		<div className="space-y-2 rounded-sm border border-line bg-surface p-3">
			<p className="text-sm font-medium text-fg">New folder</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
				<div className="flex-1 space-y-1">
					<span className="text-xs text-fg-muted">Name</span>
					<Input
						value={name}
						onChange={(event) => {
							setName(event.target.value);
							if (validationError) setValidationError(undefined);
						}}
						placeholder="e.g. Receipts"
						aria-label="Folder name"
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleCreate();
							}
						}}
					/>
				</div>
				<div className="flex-1 space-y-1">
					<span className="text-xs text-fg-muted">Inside (optional)</span>
					<Select
						value={parentId}
						onChange={(event) => setParentId(event.target.value)}
						aria-label="Parent folder"
					>
						<option value="">No parent — top level</option>
						{mailboxes.map((box) => (
							<option key={box.mailboxId} value={box.mailboxId}>
								{box.fullPath}
							</option>
						))}
					</Select>
				</div>
				<Button
					variant="primary"
					onClick={handleCreate}
					disabled={mutation.isPending || name.trim() === ""}
				>
					{mutation.isPending ? "Creating…" : "Create folder"}
				</Button>
			</div>
			{validationError && (
				<p className="text-xs text-danger" role="alert">
					{validationError}
				</p>
			)}
			{mutation.isError && (
				<Banner tone="danger" variant="soft">
					Couldn't create that folder. Please try again.
				</Banner>
			)}
		</div>
	);
}

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
			<NewFolder accountId={accountId} mailboxes={data.items} />
			<ul className="space-y-1" aria-label={`All folders for ${account.email}`}>
				{data.items.map((mailbox) => (
					<li
						key={mailbox.mailboxId}
						className="flex items-center justify-between rounded-sm px-2 py-1 text-sm text-fg"
					>
						<span className="truncate">
							{getMailboxDisplayName(mailbox.fullPath)}
						</span>
						<span className="shrink-0 text-xs text-fg-muted">
							{mailbox.fullPath}
						</span>
					</li>
				))}
			</ul>
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
