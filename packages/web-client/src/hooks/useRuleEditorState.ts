import type {
	ClauseEditState,
	ClauseField,
	FilterRule,
	MatchOperator,
	RuleScope,
} from "@remit/ui";
import { useRef, useState } from "react";
import {
	normalizeClauseValue,
	SUPPORTED_CLAUSE_FIELDS,
} from "@/lib/organize/rule-model";

export interface RuleEditorState {
	rule: FilterRule;
	setRule: (updater: (current: FilterRule) => FilterRule) => void;
	/** The clause-editing and rule-mutation handlers a {@link FilterRuleEditor} binds. */
	handlers: {
		clauseEdit: ClauseEditState | undefined;
		onStartAddClause: () => void;
		onStartEditClause: (clauseId: string) => void;
		onRemoveClause: (clauseId: string) => void;
		onChangeDraftField: (field: ClauseField) => void;
		onChangeDraftValue: (value: string) => void;
		onSubmitClause: () => void;
		onCancelClause: () => void;
		onAddWiden: () => void;
		onRemoveWiden: () => void;
		onChangeMatchOperator: (matchOperator: MatchOperator) => void;
		onChangeMove: (mailboxId: string) => void;
		onChangeScope: (scope: RuleScope) => void;
		onChangeName: (name: string) => void;
		onChangeUntil: (until: string) => void;
	};
}

interface RuleEditorStateInput {
	/** The rule the editor opens on. */
	initialRule: FilterRule;
	/**
	 * How many anchors a widen the user adds inline should carry. A search-seeded
	 * rule has no message anchor, so its editor never offers the widen and this is
	 * unused; the Organize editor passes its selection size.
	 */
	widenAnchorCount?: number;
}

/**
 * The clause-editing and rule-mutation state a filter-rule editor owns, shared by
 * every entry point onto the chip editor (RFC 038 D1) so the Organize and
 * search-derived surfaces edit the rule identically. Preview and commit stay with
 * the caller — they differ by entry point (an anchored widen count and back-apply
 * job for Organize, a literal count for a search-derived rule).
 */
export const useRuleEditorState = ({
	initialRule,
	widenAnchorCount = 1,
}: RuleEditorStateInput): RuleEditorState => {
	const [rule, setRuleState] = useState<FilterRule>(initialRule);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>();
	const nextClauseId = useRef(0);

	const setRule = (updater: (current: FilterRule) => FilterRule) =>
		setRuleState(updater);

	const startAddClause = () =>
		setClauseEdit({
			mode: "add",
			draft: { field: SUPPORTED_CLAUSE_FIELDS[0], value: "" },
		});

	const startEditClause = (clauseId: string) => {
		const clause = rule.clauses.find((entry) => entry.id === clauseId);
		if (!clause) return;
		setClauseEdit({
			mode: "edit",
			clauseId,
			draft: { field: clause.field, value: clause.value },
		});
	};

	const changeDraftField = (field: ClauseField) =>
		setClauseEdit((edit) =>
			edit ? { ...edit, draft: { ...edit.draft, field } } : edit,
		);

	const changeDraftValue = (value: string) =>
		setClauseEdit((edit) =>
			edit ? { ...edit, draft: { ...edit.draft, value } } : edit,
		);

	const submitClause = () => {
		if (!clauseEdit) return;
		const field = clauseEdit.draft.field;
		const value = normalizeClauseValue(field, clauseEdit.draft.value);
		if (value === "") return;
		setRuleState((current) => {
			if (clauseEdit.mode === "edit" && clauseEdit.clauseId) {
				return {
					...current,
					clauses: current.clauses.map((clause) =>
						clause.id === clauseEdit.clauseId
							? { id: clause.id, field, value }
							: clause,
					),
				};
			}
			nextClauseId.current += 1;
			return {
				...current,
				clauses: [
					...current.clauses,
					{ id: `clause-${nextClauseId.current}`, field, value },
				],
			};
		});
		setClauseEdit(undefined);
	};

	const removeClause = (clauseId: string) =>
		setRuleState((current) => ({
			...current,
			clauses: current.clauses.filter((clause) => clause.id !== clauseId),
		}));

	const addWiden = () =>
		setRuleState((current) => ({
			...current,
			widen: { anchorCount: Math.max(widenAnchorCount, 1) },
		}));

	const removeWiden = () =>
		setRuleState((current) => ({ ...current, widen: undefined }));

	const changeMatchOperator = (matchOperator: MatchOperator) =>
		setRuleState((current) => ({ ...current, matchOperator }));

	const changeMove = (mailboxId: string) =>
		setRuleState((current) => ({
			...current,
			moveMailboxId: mailboxId || undefined,
		}));

	const changeScope = (scope: RuleScope) =>
		setRuleState((current) => ({ ...current, scope }));

	const changeName = (name: string) =>
		setRuleState((current) => ({ ...current, name }));

	const changeUntil = (until: string) =>
		setRuleState((current) => ({ ...current, until }));

	return {
		rule,
		setRule,
		handlers: {
			clauseEdit,
			onStartAddClause: startAddClause,
			onStartEditClause: startEditClause,
			onRemoveClause: removeClause,
			onChangeDraftField: changeDraftField,
			onChangeDraftValue: changeDraftValue,
			onSubmitClause: submitClause,
			onCancelClause: () => setClauseEdit(undefined),
			onAddWiden: addWiden,
			onRemoveWiden: removeWiden,
			onChangeMatchOperator: changeMatchOperator,
			onChangeMove: changeMove,
			onChangeScope: changeScope,
			onChangeName: changeName,
			onChangeUntil: changeUntil,
		},
	};
};
