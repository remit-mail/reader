import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type FilterRule,
	FilterRuleEditor,
	type FolderOption,
	type LabelOption,
	type RuleMatchMode,
	type RuleScope,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useClauseSuggestions } from "@/hooks/useClauseSuggestions";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useCreateFilter } from "@/hooks/useFilters";
import { useCreateLabel, useLabelList } from "@/hooks/useLabels";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { useRuleEditorState } from "@/hooks/useRuleEditorState";
import { useRulePreview } from "@/hooks/useRulePreview";
import { useSelectedSubjects } from "@/hooks/useSelectedSubjects";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
import {
	canBackApplyDraft,
	type OrganizeDraft,
} from "@/lib/organize/organize-model";
import {
	buildInitialRule,
	defaultMatchMode,
	matchersForMode,
	rulePredicate,
	ruleToDraft,
	SUPPORTED_CLAUSE_FIELDS,
} from "@/lib/organize/rule-model";
import {
	BackApplyError,
	CommitError,
	FilterSaved,
	JobProgress,
	SavingState,
} from "./rule-editor-states";

interface OrganizeRuleEditorProps {
	accountId: string;
	selectedMessageIds: string[];
	/** The widen probe's matched total — seeds the live count without a re-fetch. */
	seedCount: number;
	/**
	 * The deployment ships no vector pipeline, so the widen cannot run. The rule
	 * opens on the sender-fallback `From` chips instead of the anchor.
	 */
	semanticUnavailable?: boolean;
	/** Distinct sender addresses, for the fallback clauses and the progress copy. */
	senders?: string[];
	/**
	 * The mode the editor opens on. Omitted, it opens on the semantic widen
	 * wherever the deployment can run it — a caller passes `properties` only to
	 * enter the flow on a rule built from the selection's own properties.
	 */
	seedMatchMode?: RuleMatchMode;
	/** A folder a "Something else" shortcut pre-picked. */
	seedMailboxId?: string;
	/** A scope a "Something else" shortcut pre-picked. */
	seedScope?: RuleScope;
	onClose: () => void;
}

/**
 * The Organize surface as the chip editor (RFC 038 D1). The rule is rendered and
 * edited over the existing preview/apply endpoints: clause chips, a
 * match-operator toggle, a move action, and a scope that maps one-time apply to
 * a back-apply job and standing/until to a `Filter`. Creating a filter also runs
 * the back-apply once, so the rule reaches the mail already in the mailbox and
 * not only the mail that arrives next. The count is live and the
 * commit gate holds apply until it settles, so the set the editor shows is the
 * set a commit acts on. Rendered inside the desktop dialog and the mobile sheet
 * alike, so the two cannot drift.
 */
export function OrganizeRuleEditor({
	accountId,
	selectedMessageIds,
	seedCount,
	semanticUnavailable = false,
	senders = [],
	seedMatchMode,
	seedMailboxId,
	seedScope,
	onClose,
}: OrganizeRuleEditorProps) {
	const anchorMessageId = selectedMessageIds[0];
	const senderFallback = semanticUnavailable && senders.length > 0;
	const subjects = useSelectedSubjects(selectedMessageIds);

	// Semantic stays the default wherever the deployment can serve it; the
	// properties mode is the third way in, not a replacement (RFC 038 D2).
	const [matchMode, setMatchMode] = useState<RuleMatchMode>(
		() => seedMatchMode ?? defaultMatchMode(semanticUnavailable),
	);

	const [initialRule] = useState<FilterRule>(() =>
		buildInitialRule({
			anchorMessageId,
			semanticUnavailable,
			matchMode,
			senders,
			subjects,
			selectionCount: selectedMessageIds.length,
			seedMailboxId,
			seedScope,
		}),
	);
	const { rule, setRule, handlers } = useRuleEditorState({
		initialRule,
		widenAnchorCount: selectedMessageIds.length,
	});

	// Switching mode rebuilds only what the rule matches on — the derived chips
	// and the widen. The destination, label, scope, name, and any clause the user
	// typed themselves survive, so the choice stays reversible.
	const changeMatchMode = (next: RuleMatchMode) => {
		if (next === matchMode) return;
		setMatchMode(next);
		setRule((current) => ({
			...current,
			...matchersForMode(next, {
				anchorMessageId,
				senders,
				subjects,
				selectionCount: selectedMessageIds.length,
				keepClauses: current.clauses.filter((clause) => !clause.derived),
				currentOperator: current.matchOperator,
			}),
		}));
	};

	// The selection's own senders are the likeliest values for an address clause
	// and are already in hand, so they lead the list before anything is typed.
	const clauseSuggestions = useClauseSuggestions(
		handlers.clauseEdit?.draft.field,
		handlers.clauseEdit?.draft.value ?? "",
		senders,
	);

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
	const { createLabel } = useCreateLabel(accountId);
	const onCreateLabel = async (name: string): Promise<LabelOption> => {
		const label = await createLabel(name);
		return { id: label.labelId, name: label.name, color: label.color };
	};

	const { count: preview } = useRulePreview(
		accountId,
		rulePredicate(rule, anchorMessageId),
		seedCount,
	);

	const organizeJob = useOrganizeJob(accountId);
	const createFilter = useCreateFilter(accountId);
	const { createFolder } = useCreateMailbox(accountId);

	// Creating a filter also moves the mail that already matches, not only the
	// mail that arrives next: the same retroactive back-apply the one-time scope
	// runs. The filter is created first so the rule is live before the pass, then
	// the pass runs over the existing corpus. `backApplyDraft` is the predicate
	// to run once the create succeeds, and is undefined when the rule cannot be
	// back-applied (a `HasWords` clause the vector-free pass can't evaluate — the
	// filter still saves and applies to incoming mail). It is kept, not cleared,
	// so a failed start can be retried; `backApplyStarted` guards the one-shot
	// auto-start against re-firing on re-render.
	const [backApplyDraft, setBackApplyDraft] = useState<OrganizeDraft>();
	const backApplyStarted = useRef(false);

	const commit = () => {
		const draft = ruleToDraft(rule, anchorMessageId);
		if (rule.scope === "once") {
			organizeJob.start(draft);
			return;
		}
		backApplyStarted.current = false;
		setBackApplyDraft(canBackApplyDraft(draft) ? draft : undefined);
		createFilter.createFilter(
			draft,
			rule.scope === "standing" ? "standing" : "temporary",
			(rule.name ?? "").trim(),
		);
	};

	useEffect(() => {
		if (!backApplyDraft || backApplyStarted.current || !createFilter.isSuccess)
			return;
		backApplyStarted.current = true;
		organizeJob.start(backApplyDraft);
	}, [backApplyDraft, createFilter.isSuccess, organizeJob.start]);

	const retryBackApply = () => {
		if (backApplyDraft) organizeJob.start(backApplyDraft);
	};

	if (organizeJob.isStarting || organizeJob.isRunning || organizeJob.isDone) {
		return (
			<JobProgress
				progress={organizeJob.progress}
				isDone={organizeJob.isDone}
				runningLabel={
					senderFallback
						? "Organizing mail from these senders…"
						: matchMode === "properties"
							? "Organizing matching mail…"
							: "Organizing similar mail…"
				}
				onClose={onClose}
			/>
		);
	}

	// The filter saved, but the back-apply's own request failed (a 5xx or dropped
	// connection on start, or a failed retry) — no job id was ever assigned, so no
	// JobProgress state holds. Surface it distinctly instead of falling through to
	// "Filter saved" and swallowing it: the rule is live, the move is what to
	// retry.
	if (createFilter.isSuccess && organizeJob.isError) {
		return <BackApplyError onRetry={retryBackApply} onClose={onClose} />;
	}

	if (createFilter.isPending) {
		return <SavingState />;
	}

	if (createFilter.isSuccess) {
		// The filter is saved; the back-apply is about to start (the effect hands
		// off to the job on the next tick). Keep the saving state until it takes
		// over so the success screen never flashes between them. When the rule
		// can't be back-applied, `backApplyDraft` is undefined and this is the
		// terminal state — saved, applying to incoming mail only.
		if (backApplyDraft) return <SavingState />;
		return <FilterSaved onClose={onClose} />;
	}

	if (createFilter.isError) {
		return <CommitError onRetry={createFilter.reset} onClose={onClose} />;
	}

	return (
		<FilterRuleEditor
			rule={rule}
			folders={folders}
			labels={labels}
			preview={preview}
			semanticAvailable={!semanticUnavailable}
			// A deployment without the vector pipeline has only one mode to be in,
			// so it gets no choice to make — the rule already matches on properties.
			matchMode={semanticUnavailable ? undefined : matchMode}
			onChangeMatchMode={changeMatchMode}
			clauseFields={SUPPORTED_CLAUSE_FIELDS}
			clauseSuggestions={clauseSuggestions}
			{...handlers}
			onCreateFolder={createFolder}
			onCreateLabel={onCreateLabel}
			onCommit={commit}
			onCancel={onClose}
		/>
	);
}
