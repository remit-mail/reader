import {
	accountDetailOperationsDeleteAccountMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
	microsoftOAuthOperationsMicrosoftOAuthStartMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	AccountHealthCard,
	Badge,
	Banner,
	Button,
	Dialog,
	type RowAction,
	RowActions,
	SettingsShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { AccountFormPanel } from "@/components/settings/AccountFormPanel";
import { DangerZone } from "@/components/settings/DangerZone";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatRelativeTime } from "@/lib/format";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

const accountsSearchSchema = z.object({
	editAccountId: z.string().optional(),
	focusSmtp: z.boolean().optional(),
	/** Set by the backend redirect after a successful OAuth callback */
	connected: z.string().optional(),
	/** Set by the backend redirect when the OAuth flow fails */
	oauthError: z.string().optional(),
});

export const Route = createFileRoute("/settings/accounts")({
	component: AccountsSettings,
	validateSearch: accountsSearchSchema,
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Map an OAuth error code from the `?oauthError` query param to a
 * human-readable message shown to the user.
 *
 * Exported for unit tests.
 */
export function mapOauthError(code: string): string {
	const lower = code.toLowerCase();

	if (lower === "access_denied") {
		return "You cancelled the sign-in.";
	}

	if (
		lower === "consent_required" ||
		lower.includes("admin_consent") ||
		lower.includes("interaction_required")
	) {
		return "Your organisation's admin needs to approve Remit. Ask your IT admin to grant the required permissions.";
	}

	// IMAP disabled hint — the backend surfaces this when XOAUTH2 login
	// fails because IMAP is not enabled in the Microsoft 365 tenant settings.
	if (lower.includes("imap_disabled") || lower.includes("imap disabled")) {
		return "IMAP is disabled for this account. Ask your admin to enable IMAP access in the Microsoft 365 admin centre.";
	}

	return `Sign-in failed: ${code}. Please try again.`;
}

/**
 * Derive a friendly primary label from the email's local part so
 * AccountHealthCard doesn't print the same address twice (label primary, email
 * secondary). Falls back to the full email if the local part is empty.
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

/**
 * The user-chosen display name when set, otherwise a label derived from the
 * email address.
 */
function accountLabel(account: RemitImapAccountResponse): string {
	const name = account.displayName?.trim();
	if (name) return name;
	return deriveLabel(account.email);
}

function deriveSyncLabel(account: RemitImapAccountResponse): string {
	if (!account.lastSyncAt) return "never synced";
	const relative = formatRelativeTime(account.lastSyncAt);
	return relative ? `synced ${relative}` : "never synced";
}

function deriveState(
	account: RemitImapAccountResponse,
): "healthy" | "error" | "muted" {
	if (account.muted?.value) return "muted";
	if (account.lastError) return "error";
	if (account.connectionState === "authenticated") return "healthy";
	return "error";
}

/** True when the account needs re-authentication via the OAuth flow. */
function needsReauth(account: RemitImapAccountResponse): boolean {
	return account.connectionState === "reauth_required";
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
	// biome-ignore lint/a11y/useSemanticElements: <div> with role="status" preserves block layout; <output> is inline
	<div
		className="space-y-3"
		role="status"
		aria-busy="true"
		aria-label="Loading accounts"
	>
		{(["skeleton-0", "skeleton-1"] as const).map((key) => (
			<div
				key={key}
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
	const [showAddWizard, setShowAddWizard] = useState(false);
	const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
	const [focusSmtp, setFocusSmtp] = useState(false);
	const [deletingAccountId, setDeletingAccountId] = useState<string | null>(
		null,
	);
	/** Success message shown after a successful OAuth callback */
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	/** Error message shown when the OAuth flow returned an error */
	const [oauthErrorMessage, setOauthErrorMessage] = useState<string | null>(
		null,
	);
	/** Which account is currently being reconnected via OAuth */
	const [reconnectingAccountId, setReconnectingAccountId] = useState<
		string | null
	>(null);

	const queryClient = useQueryClient();

	const {
		data: config,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(configOperationsGetConfigOptions());

	// Handle ?editAccountId deep-link
	useEffect(() => {
		if (!search.editAccountId) return;
		setEditingAccountId(search.editAccountId);
		setFocusSmtp(!!search.focusSmtp);
		navigate({
			search: {
				editAccountId: undefined,
				focusSmtp: undefined,
				connected: search.connected,
				oauthError: search.oauthError,
			},
			replace: true,
		});
	}, [
		search.editAccountId,
		search.focusSmtp,
		navigate,
		search.connected,
		search.oauthError,
	]);

	// Handle ?connected — show success, select the account, clear param
	useEffect(() => {
		if (!search.connected) return;
		setSuccessMessage("Account connected successfully.");
		setEditingAccountId(search.connected);
		queryClient.invalidateQueries({
			queryKey: configOperationsGetConfigQueryKey(),
		});
		navigate({
			search: {
				connected: undefined,
				oauthError: undefined,
				editAccountId: undefined,
				focusSmtp: undefined,
			},
			replace: true,
		});
	}, [search.connected, navigate, queryClient]);

	// Handle ?oauthError — show human-readable error, clear param
	useEffect(() => {
		if (!search.oauthError) return;
		setOauthErrorMessage(mapOauthError(search.oauthError));
		navigate({
			search: {
				oauthError: undefined,
				connected: undefined,
				editAccountId: undefined,
				focusSmtp: undefined,
			},
			replace: true,
		});
	}, [search.oauthError, navigate]);

	const reconnectMutation = useMutation({
		...microsoftOAuthOperationsMicrosoftOAuthStartMutation(),
		onSuccess: (data) => {
			window.location.assign(data.authorizationUrl);
		},
		onError: (err) => {
			setOauthErrorMessage(
				err instanceof Error ? err.message : "Failed to start reconnect",
			);
			setReconnectingAccountId(null);
		},
	});

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
		setShowAddWizard(false);
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
			onBackToMail={() => void navigate({ to: "/mail" })}
		>
			{successMessage && (
				<Banner
					tone="success"
					variant="soft"
					data-testid="oauth-success-banner"
					onDismiss={() => setSuccessMessage(null)}
				>
					{successMessage}
				</Banner>
			)}

			{oauthErrorMessage && (
				<Banner
					tone="danger"
					variant="soft"
					data-testid="oauth-error-banner"
					onDismiss={() => setOauthErrorMessage(null)}
				>
					{oauthErrorMessage}
				</Banner>
			)}

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
					onClick={() => setShowAddWizard(true)}
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
					<p className="mb-3">No accounts configured.</p>
					<Button
						variant="primary"
						size="sm"
						icon={<Plus className="size-3.5" />}
						onClick={() => setShowAddWizard(true)}
					>
						Add your first account
					</Button>
				</div>
			) : (
				<div className="space-y-3">
					{config.accounts.map((account) => {
						const isReauth = needsReauth(account);
						const isOAuthAccount = account.authType === "oauthMicrosoft";
						const isReconnecting =
							reconnectingAccountId === account.accountId &&
							reconnectMutation.isPending;

						const primaryAction: RowAction =
							isReauth && isOAuthAccount
								? {
										label: "Reconnect",
										variant: "secondary",
										busy: isReconnecting,
										busyLabel: "Redirecting…",
										onClick: () => {
											setReconnectingAccountId(account.accountId);
											reconnectMutation.mutate({
												body: { email: account.email },
											});
										},
									}
								: deriveState(account) === "error"
									? {
											label: "Reconnect",
											variant: "secondary",
											onClick: () => setEditingAccountId(account.accountId),
										}
									: {
											label: "Manage",
											variant: "ghost",
											onClick: () => setEditingAccountId(account.accountId),
										};

						const trailingButton = (
							<RowActions
								actions={[primaryAction]}
								destructive={{
									label: "Delete account",
									iconOnly: true,
									icon: <Trash2 className="size-3.5" />,
									onClick: () => setDeletingAccountId(account.accountId),
								}}
							/>
						);

						return (
							<AccountHealthCard
								key={account.accountId}
								label={accountLabel(account)}
								email={account.email}
								connector={isOAuthAccount ? "Microsoft 365" : "IMAP"}
								syncLabel={deriveSyncLabel(account)}
								state={deriveState(account)}
								errorDetail={
									isReauth ? "Re-authentication required" : account.lastError
								}
								trailing={trailingButton}
							/>
						);
					})}
				</div>
			)}

			{/* Add account wizard — steps 2–7 in a full-screen overlay */}
			{showAddWizard && (
				<div className="fixed inset-0 z-40 overflow-auto bg-canvas">
					<OnboardingWizard
						skipWelcome
						onComplete={() => {
							setShowAddWizard(false);
							queryClient.invalidateQueries({
								queryKey: configOperationsGetConfigQueryKey(),
							});
						}}
						onCancel={() => setShowAddWizard(false)}
					/>
				</div>
			)}

			{/* Add/Edit Form Panel */}
			<AccountFormPanel
				isOpen={showForm || !!editingAccountId}
				account={accountToEdit}
				focusSmtp={focusSmtp}
				onClose={handleClosePanel}
			/>

			{/* Delete Confirmation Dialog */}
			<Dialog
				open={!!deletingAccountId}
				onClose={() => setDeletingAccountId(null)}
				title="Delete account"
			>
				<header className="flex items-center gap-2 border-b border-line px-5 py-3">
					<AlertTriangle className="size-4 shrink-0 text-danger" />
					<span className="flex-1 text-sm font-semibold text-fg">
						Delete account
					</span>
					<Button
						variant="ghost"
						size="sm"
						icon={<X className="size-3.5" />}
						onClick={() => setDeletingAccountId(null)}
						aria-label="Cancel"
					/>
				</header>

				<div className="space-y-3 px-5 py-4 text-sm text-fg-muted">
					<p className="text-center text-lg font-medium text-fg">
						Are you sure?
					</p>
					{accountToDelete && (
						<p className="text-center">{accountToDelete.email}</p>
					)}
					<ul className="list-inside list-disc space-y-1">
						<li>Remove the account from your settings</li>
						<li>Stop syncing mail for this account</li>
						<li>Delete all associated data (within 24 hours)</li>
					</ul>
				</div>

				<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setDeletingAccountId(null)}
					>
						Cancel
					</Button>
					<Button
						variant="danger"
						size="sm"
						aria-busy={deleteMutation.isPending}
						icon={
							deleteMutation.isPending ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : undefined
						}
						onClick={() => {
							if (deleteMutation.isPending) return;
							if (deletingAccountId) {
								deleteMutation.mutate({
									path: { accountId: deletingAccountId },
								});
							}
						}}
					>
						{deleteMutation.isPending ? "Deleting…" : "Delete account"}
					</Button>
				</footer>
			</Dialog>

			<DangerZone />
		</SettingsShell>
	);
}
