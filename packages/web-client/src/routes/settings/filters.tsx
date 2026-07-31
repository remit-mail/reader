import {
	configOperationsGetConfigOptions,
	mailboxOperationsListMailboxesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { type LabelOption, SettingsShell } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { FilterEditorSurface } from "@/components/settings/FilterEditorSurface";
import { FiltersList } from "@/components/settings/FiltersList";
import { ErrorState } from "@/components/ui/ErrorState";
import { useDeleteFilter, useFilterList } from "@/hooks/useFilters";
import { useLabelList } from "@/hooks/useLabels";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/filters")({
	component: FiltersSettings,
});

const filtersHelp = (
	<div className="space-y-3">
		<p>
			Filters are the standing rules Organize creates. A{" "}
			<strong>Standing</strong> filter keeps working on new mail; a{" "}
			<strong>Temporary</strong> one stops on its own at the date you picked.
		</p>
		<p>
			An expired filter isn't deleted the instant it lapses — it stays here,
			marked Expired, so you can see what it did and when it stopped.
		</p>
	</div>
);

export function AccountFilters({
	account,
}: {
	account: RemitImapAccountResponse;
}) {
	const accountId = account.accountId;
	const { filters, isPending, isError, error, refetch } =
		useFilterList(accountId);
	const { deleteFilter, deletingFilterId } = useDeleteFilter(accountId);
	const [editingFilterId, setEditingFilterId] = useState<string | undefined>();

	const { data: mailboxesData } = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		staleTime: Infinity,
	});

	const mailboxName = useCallback(
		(mailboxId: string): string | undefined => {
			const mailbox = mailboxesData?.items.find(
				(item) => item.mailboxId === mailboxId,
			);
			return mailbox ? getMailboxDisplayName(mailbox.fullPath) : undefined;
		},
		[mailboxesData?.items],
	);

	const folders = useMemo(
		() =>
			buildMoveTargets(
				mailboxesData?.items ?? [],
				account.folderAppointments,
			).map((mailbox) => ({
				id: mailbox.mailboxId,
				label: getMailboxDisplayName(mailbox.fullPath),
			})),
		[mailboxesData?.items, account.folderAppointments],
	);

	const { labels: labelItems } = useLabelList(accountId);
	const labels: LabelOption[] = useMemo(
		() =>
			labelItems.map((label) => ({
				id: label.labelId,
				name: label.name,
				color: label.color,
			})),
		[labelItems],
	);
	const labelById = useMemo(
		() => new Map(labels.map((label) => [label.id, label])),
		[labels],
	);

	const editingFilter = filters.find(
		(filter) => filter.filterId === editingFilterId,
	);

	return (
		<section className="space-y-2">
			<h2 className="text-sm font-semibold text-fg">{account.email}</h2>
			{editingFilter && (
				<FilterEditorSurface
					accountId={accountId}
					filter={editingFilter}
					folders={folders}
					labels={labels}
					onClose={() => setEditingFilterId(undefined)}
				/>
			)}
			{isPending ? (
				// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label on loading skeleton provides useful context for assistive tech
				<div
					className="h-16 animate-pulse rounded-md border border-line bg-surface"
					aria-busy="true"
					aria-label={`Loading filters for ${account.email}`}
				/>
			) : isError ? (
				<ErrorState
					variant="inline"
					title={`Couldn't load filters for ${account.email}`}
					error={error}
					onRetry={() => {
						refetch();
					}}
				/>
			) : (
				<FiltersList
					filters={filters}
					mailboxName={mailboxName}
					labelById={labelById}
					onEdit={setEditingFilterId}
					onDelete={deleteFilter}
					deletingFilterId={deletingFilterId}
				/>
			)}
		</section>
	);
}

function FiltersSettings() {
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
			activeId="filters"
			title="Filters"
			description="Standing and temporary rules created by Organize, per account."
			help={filtersHelp}
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
						<AccountFilters key={account.accountId} account={account} />
					))}
				</div>
			)}
		</SettingsShell>
	);
}
