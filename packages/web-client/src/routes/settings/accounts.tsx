import {
	accountDetailOperationsDeleteAccountMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AccountCard } from "@/components/settings/AccountCard";
import { AccountFormPanel } from "@/components/settings/AccountFormPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { SlidePanel } from "@/components/ui/SlidePanel";

const accountsSearchSchema = z.object({
	editAccountId: z.string().optional(),
	focusSmtp: z.boolean().optional(),
});

export const Route = createFileRoute("/settings/accounts")({
	component: AccountsSettings,
	validateSearch: accountsSearchSchema,
});

const LoadingSkeleton = () => (
	<div className="space-y-4" aria-busy="true" aria-label="Loading accounts">
		{Array.from({ length: 2 }).map((_, i) => (
			<div
				key={i}
				className="rounded-lg border border-border p-4 animate-pulse"
			>
				<div className="h-4 bg-muted rounded w-1/3 mb-3" />
				<div className="h-3 bg-muted rounded w-2/3" />
			</div>
		))}
	</div>
);

function AccountsSettings() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

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

	return (
		<div className="max-w-2xl">
			<div className="flex items-center justify-between mb-6">
				<div>
					<h1 className="text-xl font-semibold">Accounts</h1>
					<p className="text-sm text-muted-foreground">
						Manage your email accounts
					</p>
				</div>
				<button
					type="button"
					onClick={() => setShowForm(true)}
					disabled={isError || isPending}
					className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<Plus className="size-4" />
					Add Account
				</button>
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
				<div className="text-center py-12 border border-dashed rounded-lg">
					<p className="text-muted-foreground mb-4">No accounts configured</p>
					<button
						type="button"
						onClick={() => setShowForm(true)}
						className="text-primary hover:underline"
					>
						Add your first account
					</button>
				</div>
			) : (
				<div className="space-y-4">
					{config.accounts.map((account) => (
						<AccountCard
							key={account.accountId}
							account={account}
							onEdit={(options) => {
								setEditingAccountId(account.accountId);
								setFocusSmtp(!!options?.focusSmtp);
							}}
							onDelete={() => setDeletingAccountId(account.accountId)}
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
							className="px-4 py-2 border rounded-md hover:bg-accent"
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
							className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
						>
							{deleteMutation.isPending ? "Deleting..." : "Delete Account"}
						</button>
					</>
				}
			>
				<div className="text-center">
					<p className="text-lg font-medium mb-2">Are you sure?</p>
					{accountToDelete && (
						<p className="text-muted-foreground mb-4">
							{accountToDelete.email}
						</p>
					)}
					<div className="text-left text-sm text-muted-foreground space-y-1 mt-4">
						<p>This will:</p>
						<ul className="list-disc list-inside space-y-1">
							<li>Remove the account from your settings</li>
							<li>Stop syncing mail for this account</li>
							<li>Delete all associated data (within 24 hours)</li>
						</ul>
					</div>
				</div>
			</SlidePanel>
		</div>
	);
}
