import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type FilterRule,
	FilterRuleEditor,
	type FolderOption,
	type RuleScope,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useCreateMailbox } from "@/hooks/useCreateMailbox";
import { useCreateFilter } from "@/hooks/useFilters";
import { useOrganizeJob } from "@/hooks/useOrganizeJob";
import { useRuleEditorState } from "@/hooks/useRuleEditorState";
import { useRulePreview } from "@/hooks/useRulePreview";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
import type { OrganizeDraft } from "@/lib/organize/organize-model";
import {
	buildInitialRule,
	rulePredicate,
	ruleToDraft,
	SUPPORTED_CLAUSE_FIELDS,
} from "@/lib/organize/rule-model";
import {
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
	seedMailboxId,
	seedScope,
	onClose,
}: OrganizeRuleEditorProps) {
	const anchorMessageId = selectedMessageIds[0];
	const senderFallback = semanticUnavailable && senders.length > 0;

	const [initialRule] = useState<FilterRule>(() =>
		buildInitialRule({
			anchorMessageId,
			semanticUnavailable,
			senders,
			selectionCount: selectedMessageIds.length,
			seedMailboxId,
			seedScope,
		}),
	);
	const { rule, handlers } = useRuleEditorState({
		initialRule,
		widenAnchorCount: selectedMessageIds.length,
	});

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

	const preview = useRulePreview(
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
	// the pass runs over the existing corpus. Held until the create succeeds so a
	// failed create never leaves an orphaned back-apply.
	const [backApplyDraft, setBackApplyDraft] = useState<OrganizeDraft>();

	const commit = () => {
		const draft = ruleToDraft(rule, anchorMessageId);
		if (rule.scope === "once") {
			organizeJob.start(draft);
			return;
		}
		setBackApplyDraft(draft);
		createFilter.createFilter(
			draft,
			rule.scope === "standing" ? "standing" : "temporary",
			(rule.name ?? "").trim(),
		);
	};

	useEffect(() => {
		if (!backApplyDraft || !createFilter.isSuccess) return;
		organizeJob.start(backApplyDraft);
		setBackApplyDraft(undefined);
	}, [backApplyDraft, createFilter.isSuccess, organizeJob.start]);

	if (organizeJob.isStarting || organizeJob.isRunning || organizeJob.isDone) {
		return (
			<JobProgress
				progress={organizeJob.progress}
				isDone={organizeJob.isDone}
				runningLabel={
					senderFallback
						? "Organizing mail from these senders…"
						: "Organizing similar mail…"
				}
				onClose={onClose}
			/>
		);
	}

	if (createFilter.isPending) {
		return <SavingState />;
	}

	if (createFilter.isSuccess) {
		// The filter is saved; the back-apply is about to start (the effect hands
		// off to the job on the next tick). Keep the saving state until it takes
		// over so the success screen never flashes between them.
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
			preview={preview}
			semanticAvailable={!semanticUnavailable}
			clauseFields={SUPPORTED_CLAUSE_FIELDS}
			{...handlers}
			onCreateFolder={createFolder}
			onCommit={commit}
			onCancel={onClose}
		/>
	);
}
