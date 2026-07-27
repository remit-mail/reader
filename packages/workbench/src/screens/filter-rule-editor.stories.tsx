import {
	type ClauseEditState,
	type ClauseField,
	demoClauseSuggestions,
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
	initialClauseEdit?: ClauseEditState,
) {
	const [rule, setRule] = useState<FilterRule>(initialRule);
	const [matchMode, setMatchMode] = useState(initialMatchMode);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>(
		initialClauseEdit,
	);

	const preview = useMemo<PreviewCount>(
		() => READY(rule.clauses.length * 23 + (rule.widen ? 40 : 0)),
		[rule],
	);

	return {
		rule,
		matchMode,
		folders: demoFolders,
		clauseEdit,
		clauseSuggestions: clauseEdit
			? demoClauseSuggestions(clauseEdit.draft.field, clauseEdit.draft.value)
			: undefined,
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

/**
 * A soft keyboard taking the bottom of the screen. The frame shortens by exactly
 * this much when it is up, which is what a phone browser does to the visual
 * viewport — so what the story shows above it is what the user can actually see.
 */
function SoftKeyboard() {
	return (
		<div className="shrink-0 space-y-1.5 border-t border-line bg-surface-sunken px-1.5 py-2">
			{[10, 9, 7].map((keys) => (
				<div key={keys} className="flex justify-center gap-1">
					{Array.from({ length: keys }).map((_, index) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: static keyboard skeleton, no ids
							key={index}
							className="h-8 w-7 rounded bg-surface shadow-sm"
						/>
					))}
				</div>
			))}
			<div className="flex justify-center">
				<div className="h-8 w-40 rounded bg-surface shadow-sm" />
			</div>
		</div>
	);
}

/** A phone frame with a faint mailbox behind the sheet, matching the mobile home. */
function PhoneFrame({
	children,
	width,
	keyboard = false,
}: {
	children: React.ReactNode;
	/** Screen width in CSS pixels. Defaults to the frame's own 390. */
	width?: number;
	keyboard?: boolean;
}) {
	return (
		<div
			className="mx-auto flex h-dvh w-full shrink-0 flex-col overflow-hidden bg-surface sm:my-6 sm:h-[760px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm"
			style={width ? { width, maxWidth: "100%" } : undefined}
		>
			<div className="relative min-h-0 flex-1 overflow-hidden">
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
			{keyboard && <SoftKeyboard />}
		</div>
	);
}

function MobileStory({
	initialRule,
	semanticAvailable = true,
	matchMode,
	propertyRule,
	clauseEdit,
	width,
	keyboard,
}: {
	initialRule: FilterRule;
	semanticAvailable?: boolean;
	matchMode?: RuleMatchMode;
	propertyRule?: FilterRule;
	/** Opens on the clause form, for the stories about editing a clause. */
	clauseEdit?: ClauseEditState;
	width?: number;
	keyboard?: boolean;
}) {
	const editor = useRuleEditor(
		initialRule,
		matchMode,
		propertyRule,
		clauseEdit,
	);
	return (
		<PhoneFrame width={width} keyboard={keyboard}>
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
	clauseEdit,
}: {
	initialRule: FilterRule;
	semanticAvailable?: boolean;
	matchMode?: RuleMatchMode;
	propertyRule?: FilterRule;
	clauseEdit?: ClauseEditState;
}) {
	const editor = useRuleEditor(
		initialRule,
		matchMode,
		propertyRule,
		clauseEdit,
	);
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

/**
 * Typing a `From` clause on a 411px phone with the keyboard up. The suggestions
 * take their own space directly under the value field rather than floating over
 * it, so the keyboard cannot hide the field the list belongs to and there is
 * nothing to scroll past to see what was typed. The selection's own senders lead
 * the list, marked "selected".
 */
export const MobileClauseSuggestions: Story = {
	render: () => (
		<MobileStory
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
			width={411}
			keyboard
			clauseEdit={{ mode: "add", draft: { field: "From", value: "" } }}
		/>
	),
};

/**
 * The same field once the typed value matches no known sender: the list is gone
 * and the value stands. A clause for an address that has not written yet is a
 * legitimate rule, so nothing blocks or corrects it.
 */
export const MobileClauseSuggestionsNoMatches: Story = {
	render: () => (
		<MobileStory
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
			width={411}
			keyboard
			clauseEdit={{
				mode: "add",
				draft: { field: "From", value: "someone@nowhere.test" },
			}}
		/>
	),
};

/** The domain clause's suggestions on desktop — addresses collapsed to their
 *  registrable domain, the string the matcher compares. */
export const DesktopDomainClauseSuggestions: Story = {
	render: () => (
		<DesktopStory
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
			clauseEdit={{ mode: "add", draft: { field: "FromDomain", value: "" } }}
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
