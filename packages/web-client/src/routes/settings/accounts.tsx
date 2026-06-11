import {
	accountDetailOperationsDeleteAccountMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	AccountHealthCard,
	Badge,
	Button,
	SettingsShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AccountFormPanel } from "@/components/settings/AccountFormPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { formatRelativeTime } from "@/lib/format";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

const accountsSearchSchema = z.object({
	editAccountId: z.string().optional(),
	focusSmtp: z.boolean().optional(),
});

export const Route = createFileRoute("/settings/accounts")({
	component: AccountsSettings,
	validateSearch: accountsSearchSchema,
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * The account API has no display-label field yet (backend gap). Derive a
 * friendly primary label from the email's local part so AccountHealthCard
 * doesn't print the same address twice (label primary, email secondary).
 * Falls back to the full email if the local part is empty.
 */
function deriveLabel(email: string): string {
	const local = email.split("@")[0] ?? "";
	if (!local) return email;
	return local
		.split(/[._-]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function deriveSyncLabel(account: RemitImapAccountResponse): string {
	if (account.lastSyncAt) {
		return `synced ${formatRelativeTime(account.lastSyncAt)}`;
	}
	return "never synced";
}

function deriveState(
	account: RemitImapAccountResponse,
): "healthy" | "error" | "muted" {
	if (account.muted?.value) return "muted";
	if (account.lastError) return "error";
	if (account.connectionState === "authenticated") return "healthy";
	return "error";
}

/* ------------------------------------------------------------------ */
/* Help rail copy — matches Storybook accountsHelp exactly            */
/* ------------------------------------------------------------------ */

const accountsHelp = (
	<div className="space-y-3">
		<p>
			<strong className="text-fg">Sync health</strong> shows the IMAP connection
			state and the last successful sync per account.
		</p>
		<p>
			<strong className="text-fg">Error</strong> means the last connection
			attempt failed — the raw server response is shown on the card. Reconnect
			re-runs the connection test from the add-account wizard.
		</p>
		<p>
			<strong className="text-fg">Muted</strong> accounts keep syncing but stay
			out of the daily brief and unified counts.
		</p>
	</div>
);

/* ------------------------------------------------------------------ */
/* Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

const LoadingSkeleton = () => (
	<div className="space-y-3" aria-busy="true" aria-label="Loading accounts">
		{Array.from({ length: 2 }).map((_, i) => (
			<div
				key={i}
				className="rounded-sm border border-line bg-surface animate-pulse p-4"
			>
				<div className="flex items-center gap-3">
					<div className="size-10 rounded-full bg-surface-sunken" />
					<div className="flex-1 space-y-2">
						<div className="h-4 bg-surface-sunken rounded w-1/3" />
						<div className="h-3 bg-surface-sunken rounded w-2/3" />
					</div>
				</div>
			</div>
		))}
	</div>
);

/* ------------------------------------------------------------------ */
/* Page component                                                     */
/* ------------------------------------------------------------------ */

function AccountsSettings() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const [helpOpen, setHelpOpen] = useState(true);

	const [showForm, setShowForm] = useState(false);
	const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
	const [focusSmtp, setFocusSmtp] = useState(false);
	const [deletingAccountId, setDeletingAccountId] = useState<string | null>(
		null,
	);
	const queryClient = useQueryClient();

	const {
		data: config,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(configOperationsGetConfigOptions());

	useEffect(() => {
		if (!search.editAccountId) return;
		setEditingAccountId(search.editAccountId);
		setFocusSmtp(!!search.focusSmtp);
		navigate({
			search: { editAccountId: undefined, focusSmtp: undefined },
			replace: true,
		});
	}, [search.editAccountId, search.focusSmtp, navigate]);

	const deleteMutation = useMutation({
		...accountDetailOperationsDeleteAccountMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
			setDeletingAccountId(null);
		},
	});

	const accountToDelete = config?.accounts.find(
		(a) => a.accountId === deletingAccountId,
	);

	const accountToEdit = config?.accounts.find(
		(a) => a.accountId === editingAccountId,
	);

	const handleClosePanel = () => {
		setShowForm(false);
		setEditingAccountId(null);
		setFocusSmtp(false);
	};

	const handleSelectNav = (id: string) => {
		const path = SETTINGS_ID_TO_PATH[id];
		if (path) void navigate({ to: path });
	};

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="accounts"
			title="Accounts"
			description="Every account keeps syncing — muted ones just stay out of unified views."
			help={accountsHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
			onSelect={handleSelectNav}
		>
			<div className="flex items-center justify-between">
				<Badge tone="neutral">
					{isPending || isError
						? "accounts"
						: `${config.accounts.length} ${config.accounts.length === 1 ? "account" : "accounts"}`}
				</Badge>
				<Button
					variant="primary"
					size="sm"
					icon={<Plus className="size-3.5" />}
					disabled={isError || isPending}
					onClick={() => setShowForm(true)}
				>
					Add account
				</Button>
			</div>

			{isPending ? (
				<LoadingSkeleton />
			) : isError ? (
				<ErrorState
					title="Couldn't load accounts"
					error={error}
					onRetry={() => {
						refetch();
					}}
				/>
			) : config.accounts.length === 0 ? (
				<div
					className="py-12 text-sm text-fg-muted"
					data-testid="accounts-empty"
				>
					<p className="mb-2">No accounts configured.</p>
					<button
						type="button"
						onClick={() => setShowForm(true)}
						className="text-accent-2 hover:underline"
					>
						Add your first account
					</button>
				</div>
			) : (
				<div className="space-y-3">
					{config.accounts.map((account) => (
						<AccountHealthCard
							key={account.accountId}
							label={deriveLabel(account.email)}
							email={account.email}
							connector="IMAP"
							syncLabel={deriveSyncLabel(account)}
							state={deriveState(account)}
							errorDetail={account.lastError}
							trailing={
								deriveState(account) === "error" ? (
									<Button
										variant="secondary"
										size="sm"
										onClick={() => setEditingAccountId(account.accountId)}
									>
										Reconnect
									</Button>
								) : (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setEditingAccountId(account.accountId)}
									>
										Manage
									</Button>
								)
							}
						/>
					))}
				</div>
			)}

			{/* Add/Edit Form Panel */}
			<AccountFormPanel
				isOpen={showForm || !!editingAccountId}
				account={accountToEdit}
				focusSmtp={focusSmtp}
				onClose={handleClosePanel}
			/>

			{/* Delete Confirmation Panel */}
			<SlidePanel
				isOpen={!!deletingAccountId}
				onClose={() => setDeletingAccountId(null)}
				title="Delete Account"
				footer={
					<>
						<button
							type="button"
							onClick={() => setDeletingAccountId(null)}
							className="px-4 py-2 border rounded-md hover:bg-surface-raised"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => {
								if (deletingAccountId) {
									deleteMutation.mutate({
										path: { accountId: deletingAccountId },
									});
								}
							}}
							disabled={deleteMutation.isPending}
							className="px-4 py-2 bg-danger text-canvas rounded-md hover:bg-danger/90 disabled:opacity-50"
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete Account"}
						</button>
					</>
				}
			>
				<div className="text-center">
					<p className="text-lg font-medium mb-2">Are you sure?</p>
					{accountToDelete && (
						<p className="text-fg-muted mb-4">{accountToDelete.email}</p>
					)}
					<div className="text-left text-sm text-fg-muted space-y-1 mt-4">
						<p>This will:</p>
						<ul className="list-disc list-inside space-y-1">
							<li>Remove the account from your settings</li>
							<li>Stop syncing mail for this account</li>
							<li>Delete all associated data (within 24 hours)</li>
						</ul>
					</div>
				</div>
			</SlidePanel>
		</SettingsShell>
	);
}
