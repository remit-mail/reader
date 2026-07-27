import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type FilterRule,
	FilterRuleEditor,
	type FolderOption,
	SearchConversionNoticeView,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCreateFilter } from "@/hooks/useFilters";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { useRuleEditorState } from "@/hooks/useRuleEditorState";
import { useRulePreview } from "@/hooks/useRulePreview";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
import {
	rulePredicate,
	ruleToDraft,
	SUPPORTED_CLAUSE_FIELDS,
} from "@/lib/organize/rule-model";
import {
	buildSearchRule,
	type SearchConversion,
} from "@/lib/organize/search-to-rule";
import {
	CommitError,
	FilterSaved,
	JobProgress,
	SavingState,
} from "./rule-editor-states";

interface SearchFilterEditorProps {
	/** The account the filter is created for (an `account:` facet, else the active account). */
	accountId: string;
	/** The converted search — its clauses seed the rule, its drops seed the notice. */
	conversion: SearchConversion;
	/**
	 * The converted literal predicate's live count, seeding the editor without a
	 * re-fetch. Absent when the predicate is one the vector-free matcher refuses —
	 * a `HasWords` clause from the search's free text — in which case the count
	 * region says so and the one-time apply is held; saving it as a standing rule
	 * still works, since the index-time matcher does read message bodies.
	 */
	seedCount?: number;
	onClose: () => void;
}

/**
 * The filter-from-search surface as the chip editor (RFC 038 D5). The current
 * search's literal terms and facets arrive already converted to clauses; this
 * opens the shared rule editor pre-filled on them, over the same preview/apply
 * endpoints as Organize. The conversion notice states what the search carried
 * that the filter cannot — a folder scope, non-clause facets, semantic reach.
 *
 * A search-derived rule has no message anchor, so the semantic widen chip is not
 * offered here (its loss, where the deployment could have served it, is the
 * notice's job). The commit gate is the same: the count on screen is the literal
 * set a commit acts on.
 */
export function SearchFilterEditor({
	accountId,
	conversion,
	seedCount,
	onClose,
}: SearchFilterEditorProps) {
	const [initialRule] = useState<FilterRule>(() => buildSearchRule(conversion));
	const { rule, handlers } = useRuleEditorState({ initialRule });

	const { data: mailboxesData } = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const folders: FolderOption[] = useMemo(
		() =>
			buildMoveTargets(mailboxesData?.items ?? []).map((mailbox) => ({
				id: mailbox.mailboxId,
				label: getMailboxDisplayName(mailbox.fullPath),
			})),
		[mailboxesData?.items],
	);

	const preview = useRulePreview(accountId, rulePredicate(rule), seedCount);

	const organizeJob = useOrganizeJob(accountId);
	const createFilter = useCreateFilter(accountId);

	const commit = () => {
		const draft = ruleToDraft(rule);
		if (rule.scope === "once") {
			organizeJob.start(draft);
			return;
		}
		createFilter.createFilter(
			draft,
			rule.scope === "standing" ? "standing" : "temporary",
			(rule.name ?? "").trim(),
		);
	};

	if (organizeJob.isStarting || organizeJob.isRunning || organizeJob.isDone) {
		return (
			<JobProgress
				progress={organizeJob.progress}
				isDone={organizeJob.isDone}
				runningLabel="Organizing your mail…"
				onClose={onClose}
			/>
		);
	}

	if (createFilter.isPending) return <SavingState />;
	if (createFilter.isSuccess) return <FilterSaved onClose={onClose} />;
	if (createFilter.isError)
		return <CommitError onRetry={createFilter.reset} onClose={onClose} />;

	return (
		<FilterRuleEditor
			rule={rule}
			folders={folders}
			preview={preview}
			notice={
				<SearchConversionNoticeView
					notice={{
						scopedOutFolder: conversion.scopedOut?.label,
						droppedFacets: conversion.droppedFacets.map((facet) => facet.label),
						droppedSemantic: conversion.droppedSemantic,
					}}
				/>
			}
			semanticAvailable={false}
			clauseFields={SUPPORTED_CLAUSE_FIELDS}
			{...handlers}
			onCommit={commit}
			onCancel={onClose}
		/>
	);
}
