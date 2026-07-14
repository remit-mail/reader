import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { Badge, Button, Input, Select } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useCreateFilter } from "@/hooks/useFilters";
import { useMoveMessages } from "@/hooks/useMoveMessages";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
import { pickedDateToExpiresAt } from "@/lib/organize/filter-status";
import {
	commitButtonLabel,
	commitDisabledReason,
	scopeActionCount,
} from "@/lib/organize/organize-copy";
import type {
	OrganizeDraft,
	OrganizeScope,
} from "@/lib/organize/organize-model";

interface OrganizePanelProps {
	accountId: string;
	mailboxId: string;
	selectedMessageIds: string[];
	anchorMessageId: string;
	/** Similar messages the widen preview matched. */
	matchedCount: number;
	onClose: () => void;
}

const SCOPE_OPTIONS: { id: OrganizeScope; label: string; caption: string }[] = [
	{
		id: "just-these",
		label: "Just these",
		caption: "the ones you selected",
	},
	{
		id: "all-like-these",
		label: "All like these",
		caption: "including the similar ones found now",
	},
	{
		id: "standing",
		label: "These and new mail like this",
		caption: "keeps working on future mail",
	},
	{
		id: "temporary",
		label: "Until a date",
		caption: "stops on its own",
	},
];

export function OrganizePanel({
	accountId,
	mailboxId,
	selectedMessageIds,
	anchorMessageId,
	matchedCount,
	onClose,
}: OrganizePanelProps) {
	const [scope, setScope] = useState<OrganizeScope>("all-like-these");
	const [moveMailboxId, setMoveMailboxId] = useState<string>("");
	const [name, setName] = useState("");
	const [pickedDate, setPickedDate] = useState("");

	const { data: mailboxesData } = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		staleTime: Infinity,
	});

	const folderOptions = useMemo(() => {
		const targets = buildMoveTargets(mailboxesData?.items ?? []);
		return targets.map((mailbox) => ({
			id: mailbox.mailboxId,
			label: getMailboxDisplayName(mailbox.fullPath),
		}));
	}, [mailboxesData?.items]);

	const draft: OrganizeDraft = useMemo(
		() => ({
			anchorMessageId,
			matchOperator: "And",
			literalClauses: [],
			moveMailboxId: moveMailboxId || undefined,
			expiresAt:
				scope === "temporary" ? pickedDateToExpiresAt(pickedDate) : undefined,
		}),
		[anchorMessageId, moveMailboxId, scope, pickedDate],
	);

	const { moveMessages } = useMoveMessages({ mailboxId, accountId });
	const organizeJob = useOrganizeJob(accountId);
	const createFilter = useCreateFilter(accountId);

	const selectionCount = selectedMessageIds.length;
	const actionCount = scopeActionCount(scope, selectionCount, matchedCount);

	const disabledReason = commitDisabledReason({
		draft,
		scope,
		name,
		pickedDate,
	});

	const handleCommit = () => {
		if (disabledReason) return;
		switch (scope) {
			case "just-these":
				if (moveMailboxId) moveMessages(selectedMessageIds, moveMailboxId);
				onClose();
				return;
			case "all-like-these":
				organizeJob.start(draft);
				return;
			case "standing":
				createFilter.createFilter(draft, "standing", name.trim());
				return;
			case "temporary":
				createFilter.createFilter(draft, "temporary", name.trim());
				return;
		}
	};

	if (organizeJob.isRunning || organizeJob.isDone) {
		return (
			<JobProgress
				progress={organizeJob.progress}
				isDone={organizeJob.isDone}
				onClose={onClose}
			/>
		);
	}

	if (createFilter.isSuccess) {
		return (
			<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
				<CheckCircle2 className="size-8 text-positive" />
				<p className="text-sm font-medium text-fg">Filter saved</p>
				<p className="max-w-xs text-xs text-fg-muted">
					You can see it, and when it expires, under Settings › Filters.
				</p>
				<Button variant="primary" onClick={onClose} className="mt-2">
					Done
				</Button>
			</div>
		);
	}

	const needsName = scope === "standing" || scope === "temporary";

	return (
		<div className="flex min-h-0 flex-col">
			<div className="border-b border-line px-5 py-3">
				<h2 className="text-sm font-semibold text-fg">Organize</h2>
				<p className="mt-0.5 text-xs text-fg-muted">
					{matchedCount} similar message{matchedCount === 1 ? "" : "s"} found
					{selectionCount > 0 ? ` from ${selectionCount} selected` : ""}.
				</p>
			</div>

			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
				<section className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
					<p className="text-sm leading-relaxed text-fg-muted">
						{scope === "standing" && (
							<span className="font-semibold text-fg">Always keep </span>
						)}
						{scope === "standing" ? "" : "Keep "}
						{scope === "just-these" ? "these" : "emails like these"} in
					</p>
					<Select
						aria-label="Destination folder"
						value={moveMailboxId}
						onChange={(e) => setMoveMailboxId(e.target.value)}
					>
						<option value="">Choose a folder…</option>
						{folderOptions.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</Select>

					<div className="flex items-center gap-2 pt-1">
						<Badge tone="neutral">label them…</Badge>
						<span className="text-2xs text-fg-subtle">
							Labeling isn't available yet — arrives with mail-labeling (RFC
							031).
						</span>
					</div>
				</section>

				<section className="space-y-1.5">
					{SCOPE_OPTIONS.map((option) => {
						const active = scope === option.id;
						return (
							<button
								key={option.id}
								type="button"
								onClick={() => setScope(option.id)}
								className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
									active
										? "border-accent-2 bg-accent-2-soft"
										: "border-line bg-surface hover:bg-surface-sunken"
								}`}
							>
								<span
									className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
										active
											? "border-accent-2 bg-accent-2"
											: "border-line bg-surface"
									}`}
								>
									{active && (
										<span className="size-1.5 rounded-full bg-white" />
									)}
								</span>
								<span className="min-w-0">
									<span
										className={`block text-sm font-medium ${
											active ? "text-accent-2" : "text-fg"
										}`}
									>
										{option.label}
									</span>
									<span className="block text-xs text-fg-subtle">
										{option.caption}
									</span>
								</span>
							</button>
						);
					})}
				</section>

				{needsName && (
					<section className="space-y-2">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Name this filter (e.g. Travel)"
							aria-label="Filter name"
						/>
						{scope === "temporary" && (
							<label className="flex items-center gap-2 text-xs text-fg-muted">
								Until
								<input
									type="date"
									value={pickedDate}
									onChange={(e) => setPickedDate(e.target.value)}
									aria-label="Expiry date"
									className="rounded-md border border-line bg-surface-sunken px-2 py-1 text-sm text-fg"
								/>
							</label>
						)}
					</section>
				)}
			</div>

			<div className="space-y-2 border-t border-line px-5 py-3">
				{disabledReason && (
					// biome-ignore lint/a11y/useSemanticElements: <p> with role="status" keeps block layout; <output> is inline
					<p className="text-xs text-fg-subtle" role="status">
						{disabledReason}
					</p>
				)}
				{createFilter.isError && (
					<p className="text-xs text-danger" role="alert">
						Couldn't save the filter. Please try again.
					</p>
				)}
				<Button
					variant="primary"
					onClick={handleCommit}
					disabled={
						!!disabledReason || createFilter.isPending || organizeJob.isStarting
					}
					className="w-full"
				>
					{createFilter.isPending
						? "Saving…"
						: commitButtonLabel(scope, actionCount)}
				</Button>
				<Button variant="ghost" onClick={onClose} className="w-full">
					Not now
				</Button>
			</div>
		</div>
	);
}

function JobProgress({
	progress,
	isDone,
	onClose,
}: {
	progress: ReturnType<typeof useOrganizeJob>["progress"];
	isDone: boolean;
	onClose: () => void;
}) {
	const failed = progress.state === "Failed";
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
			{!isDone ? (
				<Loader2 className="size-8 animate-spin text-accent-2" />
			) : failed ? (
				<span className="text-sm font-semibold text-danger">
					Organize failed
				</span>
			) : (
				<CheckCircle2 className="size-8 text-positive" />
			)}

			{!isDone && (
				<p className="text-sm font-medium text-fg">Organizing similar mail…</p>
			)}

			{isDone && !failed && (
				<div className="text-sm text-fg">
					<p className="font-medium">Done</p>
					<p className="mt-1 text-xs text-fg-muted">
						{progress.appliedCount} of {progress.matchedCount} moved
						{progress.failedCount > 0
							? ` · ${progress.failedCount} failed`
							: ""}
						.
					</p>
				</div>
			)}

			{isDone && failed && (
				<p className="max-w-xs text-xs text-fg-muted">
					{progress.errorMessage || "Something went wrong. Please try again."}
				</p>
			)}

			{isDone && (
				<Button variant="primary" onClick={onClose} className="mt-2">
					Done
				</Button>
			)}
		</div>
	);
}
