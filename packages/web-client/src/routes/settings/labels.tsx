import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapLabelColor,
	RemitImapLabelResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	Banner,
	Button,
	Input,
	labelColorOptions,
	Select,
	SettingsShell,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LabelsList } from "@/components/settings/LabelsList";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorState } from "@/components/ui/ErrorState";
import {
	useCreateLabel,
	useDeleteLabel,
	useLabelList,
	useUpdateLabel,
} from "@/hooks/useLabels";
import { deleteLabelConfirmCopy } from "@/lib/organize/label-delete-copy";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/labels")({
	component: LabelsSettings,
});

const labelsHelp = (
	<div className="space-y-3">
		<p>
			Labels mark mail without moving it — a message can carry any number of
			them alongside whichever folder it lives in.
		</p>
		<p>
			Use a label in a filter's action to have new (and existing) mail label
			itself automatically, or apply one to a selection directly from the
			mailbox.
		</p>
		<p>
			Deleting a label removes it from every message, and deletes every filter
			that applies it — the confirmation names how many.
		</p>
	</div>
);

/** Create a label for one account. A name, a color, and a create button. */
function NewLabel({ accountId }: { accountId: string }) {
	const { createLabel, isPending, isError } = useCreateLabel(accountId);
	const [name, setName] = useState("");
	const [color, setColor] = useState<RemitImapLabelColor>("Default");

	const handleCreate = () => {
		const trimmed = name.trim();
		if (trimmed === "") return;
		createLabel(trimmed, color).then(() => {
			setName("");
			setColor("Default");
		});
	};

	return (
		<div className="space-y-2 rounded-sm border border-line bg-surface p-3">
			<p className="text-sm font-medium text-fg">New label</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-end">
				<div className="flex-1 space-y-1">
					<span className="text-xs text-fg-muted">Name</span>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Receipts"
						aria-label="Label name"
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleCreate();
							}
						}}
					/>
				</div>
				<div className="space-y-1">
					<span className="text-xs text-fg-muted">Color</span>
					<Select
						value={color}
						onChange={(event) =>
							setColor(event.target.value as RemitImapLabelColor)
						}
						aria-label="Label color"
						className="w-28"
					>
						{labelColorOptions.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</Select>
				</div>
				<Button
					variant="primary"
					onClick={handleCreate}
					disabled={isPending || name.trim() === ""}
				>
					{isPending ? "Creating…" : "Create label"}
				</Button>
			</div>
			{isError && (
				<Banner tone="danger" variant="soft">
					Couldn't create that label. Please try again.
				</Banner>
			)}
		</div>
	);
}

function AccountLabels({ account }: { account: RemitImapAccountResponse }) {
	const accountId = account.accountId;
	const { labels, isPending, isError, error, refetch } =
		useLabelList(accountId);
	const { updateLabel } = useUpdateLabel(accountId);
	const { deleteLabel, deletingLabelId } = useDeleteLabel(accountId);
	const [pendingDelete, setPendingDelete] = useState<RemitImapLabelResponse>();

	return (
		<section className="space-y-2">
			<h2 className="text-sm font-semibold text-fg">{account.email}</h2>
			{isPending ? (
				// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label on loading skeleton provides useful context for assistive tech
				<div
					className="h-16 animate-pulse rounded-md border border-line bg-surface"
					aria-busy="true"
					aria-label={`Loading labels for ${account.email}`}
				/>
			) : isError ? (
				<ErrorState
					variant="inline"
					title={`Couldn't load labels for ${account.email}`}
					error={error}
					onRetry={() => {
						refetch();
					}}
				/>
			) : (
				<LabelsList
					labels={labels}
					onRename={(labelId, name) => updateLabel(labelId, { name })}
					onRecolor={(labelId, color) =>
						updateLabel(labelId, {
							color: color as RemitImapLabelResponse["color"],
						})
					}
					onDelete={setPendingDelete}
					deletingLabelId={deletingLabelId}
				/>
			)}
			<NewLabel accountId={accountId} />
			{pendingDelete &&
				(() => {
					const copy = deleteLabelConfirmCopy(
						pendingDelete.name,
						pendingDelete.filterCount,
					);
					return (
						<ConfirmDialog
							isOpen
							title={copy.title}
							description={copy.description}
							confirmLabel="Delete label"
							destructive
							isBusy={deletingLabelId === pendingDelete.labelId}
							onConfirm={() => {
								deleteLabel(pendingDelete.labelId);
								setPendingDelete(undefined);
							}}
							onCancel={() => setPendingDelete(undefined)}
						/>
					);
				})()}
		</section>
	);
}

function LabelsSettings() {
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
			activeId="labels"
			title="Labels"
			description="Mark mail without moving it, per account."
			help={labelsHelp}
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
						<AccountLabels key={account.accountId} account={account} />
					))}
				</div>
			)}
		</SettingsShell>
	);
}
