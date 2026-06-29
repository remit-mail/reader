import {
	configOperationsGetConfigOptions,
	mailboxDetailOperationsRenameMailboxMutation,
	mailboxOperationsListMailboxesOptions,
	mailboxOperationsListMailboxesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	FolderNameList,
	type FolderRole,
	SettingsShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import {
	buildCommitBody,
	buildFolderDescriptors,
	buildResetBody,
} from "@/lib/folder-names";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/folders")({
	component: FoldersSettings,
});

const foldersHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Provider name</strong> is the folder as your
			mail server reports it — read-only.
		</p>
		<p>
			<strong className="text-fg">Role</strong> is what we detected the folder
			to be. Correct it with the picker; set a row to Custom to drop it from
			this list.
		</p>
		<p>
			<strong className="text-fg">Display name</strong> is what the sidebar
			shows. Leave it blank to use the canonical default for the role.
		</p>
	</div>
);

/** One account's mailboxes, fed to the kit list. Owns its own query + PATCH. */
function AccountFolderNames({
	account,
}: {
	account: RemitImapAccountResponse;
}) {
	const queryClient = useQueryClient();
	const accountId = account.accountId;

	const { data, isPending, isError, error, refetch } = useQuery(
		mailboxOperationsListMailboxesOptions({ path: { accountId } }),
	);

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

	const handleCommit = (
		mailboxId: string,
		next: { role: FolderRole; name: string },
	) => {
		renameMutation.mutate({
			path: { accountId, mailboxId },
			body: buildCommitBody(next),
		});
	};

	const handleReset = (mailboxId: string) => {
		renameMutation.mutate({
			path: { accountId, mailboxId },
			body: buildResetBody(),
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

	return (
		<div className="space-y-2">
			{renameMutation.isError && (
				<Banner tone="danger" variant="soft">
					Couldn't save that change. Please try again.
				</Banner>
			)}
			<FolderNameList
				accountEmail={account.email}
				folders={buildFolderDescriptors(data.items)}
				onCommit={handleCommit}
				onReset={handleReset}
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
			title="Folder names"
			description="Rename a recognized folder, or correct the role we detected, per account."
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
						<AccountFolderNames key={account.accountId} account={account} />
					))}
				</div>
			)}
		</SettingsShell>
	);
}
