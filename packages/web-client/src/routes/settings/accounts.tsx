import {
	accountDetailOperationsDeleteAccountMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { AccountCard } from "@/components/settings/AccountCard";
import { AccountFormPanel } from "@/components/settings/AccountFormPanel";
import { SlidePanel } from "@/components/ui/SlidePanel";

export const Route = createFileRoute("/settings/accounts")({
	component: AccountsSettings,
});

function AccountsSettings() {
	const [showForm, setShowForm] = useState(false);
	const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
	const [deletingAccountId, setDeletingAccountId] = useState<string | null>(
		null,
	);
	const queryClient = useQueryClient();

	const { data: config } = useSuspenseQuery(configOperationsGetConfigOptions());

	const deleteMutation = useMutation({
		...accountDetailOperationsDeleteAccountMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
			setDeletingAccountId(null);
		},
	});

	const accountToDelete = config.accounts.find(
		(a) => a.accountId === deletingAccountId,
	);

	const accountToEdit = config.accounts.find(
		(a) => a.accountId === editingAccountId,
	);

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
					className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
				>
					<Plus className="size-4" />
					Add Account
				</button>
			</div>

			{config.accounts.length === 0 ? (
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
							onEdit={() => setEditingAccountId(account.accountId)}
							onDelete={() => setDeletingAccountId(account.accountId)}
						/>
					))}
				</div>
			)}

			{/* Add/Edit Form Panel */}
			<AccountFormPanel
				isOpen={showForm || !!editingAccountId}
				account={accountToEdit}
				onClose={() => {
					setShowForm(false);
					setEditingAccountId(null);
				}}
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
