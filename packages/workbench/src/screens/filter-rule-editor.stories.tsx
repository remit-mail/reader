import {
	type ClauseEditState,
	type ClauseField,
	demoFolders,
	demoRule,
	demoSenderFallbackRule,
	demoSubjectPrefillRule,
	demoVocabularyRule,
	type FilterRule,
	FilterRuleDialog,
	FilterRuleSheet,
	type PreviewCount,
	type RuleClause,
	type RuleMatchMode,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";

const meta: Meta = {
	title: "Screens/Filter rule editor",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const READY = (count: number, stale?: boolean): PreviewCount => ({
	status: "ready",
	count,
	stale,
});

/**
 * Owns the rule state and threads it into whichever shell the story renders —
 * the same editor drives the mobile sheet and the desktop dialog (RFC 038 D1),
 * so the two can never drift.
 */
function useRuleEditor(
	initialRule: FilterRule,
	initialMatchMode?: RuleMatchMode,
	propertyRule: FilterRule = demoSenderFallbackRule,
) {
	const [rule, setRule] = useState<FilterRule>(initialRule);
	const [matchMode, setMatchMode] = useState(initialMatchMode);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>();

	const preview = useMemo<PreviewCount>(
		() => READY(rule.clauses.length * 23 + (rule.widen ? 40 : 0)),
		[rule],
	);

	return {
		rule,
		matchMode,
		folders: demoFolders,
		clauseEdit,
		preview,
		onStartAddClause: () =>
			setClauseEdit({ mode: "add", draft: { field: "From", value: "" } }),
		onStartEditClause: (clauseId: string) => {
			const clause = rule.clauses.find((c) => c.id === clauseId);
			if (!clause) return;
			setClauseEdit({
				mode: "edit",
				clauseId,
				draft: { field: clause.field, value: clause.value },
			});
		},
		onRemoveClause: (clauseId: string) => {
			setRule((r) => ({
				...r,
				clauses: r.clauses.filter((c) => c.id !== clauseId),
			}));
		},
		onChangeDraftField: (field: ClauseField) =>
			setClauseEdit((e) => (e ? { ...e, draft: { ...e.draft, field } } : e)),
		onChangeDraftValue: (value: string) =>
			setClauseEdit((e) => (e ? { ...e, draft: { ...e.draft, value } } : e)),
		onSubmitClause: () => {
			setClauseEdit((edit) => {
				if (!edit) return undefined;
				setRule((r) => {
					if (edit.mode === "add") {
						const clause: RuleClause = {
							id: `c-${Date.now()}`,
							field: edit.draft.field,
							value: edit.draft.value,
						};
						return { ...r, clauses: [...r.clauses, clause] };
					}
					return {
						...r,
						clauses: r.clauses.map((c) =>
							c.id === edit.clauseId
								? { ...c, field: edit.draft.field, value: edit.draft.value }
								: c,
						),
					};
				});
				return undefined;
			});
		},
		onCancelClause: () => setClauseEdit(undefined),
		onAddWiden: () => {
			setRule((r) => ({ ...r, widen: { anchorCount: 2 } }));
		},
		onRemoveWiden: () => {
			setRule((r) => ({ ...r, widen: undefined }));
		},
		onChangeMatchOperator: (matchOperator: FilterRule["matchOperator"]) => {
			setRule((r) => ({ ...r, matchOperator }));
		},
		onChangeMatchMode: (mode: RuleMatchMode) => {
			setMatchMode(mode);
			// Only the matchers are rebuilt — the destination, scope and name the
			// user already picked survive the switch, as they do in the app.
			setRule((r) =>
				mode === "properties"
					? {
							...r,
							clauses: propertyRule.clauses,
							matchOperator: "any",
							widen: undefined,
						}
					: {
							...r,
							clauses: initialRule.clauses,
							matchOperator: initialRule.matchOperator,
							widen: initialRule.widen ?? { anchorCount: 2 },
						},
			);
		},
		onChangeMove: (moveMailboxId: string) =>
			setRule((r) => ({ ...r, moveMailboxId: moveMailboxId || undefined })),
		onChangeScope: (scope: FilterRule["scope"]) =>
			setRule((r) => ({ ...r, scope })),
		onChangeName: (name: string) => setRule((r) => ({ ...r, name })),
		onChangeUntil: (until: string) => setRule((r) => ({ ...r, until })),
		onCommit: () => {},
	};
}

/** A phone frame with a faint mailbox behind the sheet, matching the mobile home. */
function PhoneFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[760px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
			<div className="divide-y divide-line opacity-50">
				{Array.from({ length: 8 }).map((_, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static backdrop skeleton, no ids
						key={index}
						className="flex items-start gap-3 px-row-inset py-2.5"
					>
						<div className="mt-0.5 size-7 shrink-0 rounded-full bg-surface-sunken" />
						<div className="min-w-0 flex-1 space-y-1">
							<div className="h-2.5 w-1/3 rounded bg-surface-sunken" />
							<div className="h-2 w-2/3 rounded bg-surface-sunken" />
						</div>
					</div>
				))}
			</div>
			{children}
		</div>
	);
}

function MobileStory({
	initialRule,
	semanticAvailable = true,
	matchMode,
	propertyRule,
}: {
	initialRule: FilterRule;
	semanticAvailable?: boolean;
	matchMode?: RuleMatchMode;
	propertyRule?: FilterRule;
}) {
	const editor = useRuleEditor(initialRule, matchMode, propertyRule);
	return (
		<PhoneFrame>
			<FilterRuleSheet
				open
				onClose={() => {}}
				semanticAvailable={semanticAvailable}
				{...editor}
			/>
		</PhoneFrame>
	);
}

function DesktopStory({
	initialRule,
	semanticAvailable = true,
	matchMode,
	propertyRule,
}: {
	initialRule: FilterRule;
	semanticAvailable?: boolean;
	matchMode?: RuleMatchMode;
	propertyRule?: FilterRule;
}) {
	const editor = useRuleEditor(initialRule, matchMode, propertyRule);
	return (
		<div className="h-dvh w-full bg-canvas">
			<FilterRuleDialog
				open
				onClose={() => {}}
				semanticAvailable={semanticAvailable}
				{...editor}
			/>
		</div>
	);
}

/** The rule editor on mobile — a bottom sheet over the mailbox. */
export const MobileSheet: Story = {
	render: () => <MobileStory initialRule={demoRule} />,
};

/** The rule editor on desktop — the centered dialog. */
export const DesktopDialog: Story = {
	render: () => <DesktopStory initialRule={demoRule} />,
};

/** Any-of clauses with the ticket-B ListId and FromDomain fields, on desktop. */
export const DesktopAnyOfClauses: Story = {
	render: () => <DesktopStory initialRule={demoVocabularyRule} />,
};

/**
 * The Organize surface on a phone, where the rule can be matched either way.
 * It opens on "Anything similar"; "Its properties" swaps the widen for clauses
 * derived from the messages that were selected — a rule with no semantics in it.
 */
export const MobileMatchMode: Story = {
	render: () => (
		<MobileStory
			initialRule={{ ...demoRule, clauses: [] }}
			matchMode="similar"
			propertyRule={demoSenderFallbackRule}
		/>
	),
};

/**
 * Properties matching where the selection's senders differ: the prefill falls
 * back to the part the subjects share, on desktop.
 */
export const DesktopMatchOnSubject: Story = {
	render: () => (
		<DesktopStory
			initialRule={demoSubjectPrefillRule}
			matchMode="properties"
			propertyRule={demoSubjectPrefillRule}
		/>
	),
};

/** The sender-fallback (#251) rendered as editable From chips, on mobile. */
export const MobileSenderFallback: Story = {
	render: () => (
		<MobileStory
			initialRule={demoSenderFallbackRule}
			semanticAvailable={false}
		/>
	),
};

/** A deployment without the widen capability — the semantic chip is not offered. */
export const DesktopSemanticUnavailable: Story = {
	render: () => (
		<DesktopStory
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
		/>
	),
};

/** A standing rule carrying an anchor this deployment cannot evaluate — widen inactive. */
export const DesktopDegradedWiden: Story = {
	render: () => (
		<DesktopStory
			initialRule={{ ...demoRule, widen: { anchorCount: 2, inactive: true } }}
			semanticAvailable={false}
		/>
	),
};
