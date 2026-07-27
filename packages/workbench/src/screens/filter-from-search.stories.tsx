import {
	type ClauseEditState,
	type ClauseField,
	demoFolders,
	type FilterRule,
	FilterRuleDialog,
	FilterRuleSheet,
	type PreviewCount,
	type RuleClause,
	type SearchConversionNotice,
	SearchConversionNoticeView,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";

const meta: Meta = {
	title: "Screens/Filter from search",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const READY = (count: number): PreviewCount => ({ status: "ready", count });

/** A rule seeded from a search: literal terms as HasWords, a sender as From. */
const searchRule = (clauses: RuleClause[]): FilterRule => ({
	clauses,
	matchOperator: "all",
	scope: "standing",
	name: "",
});

/**
 * What the count region says for a rule the vector-free matcher refuses to
 * evaluate. Mirrors `UNCOUNTABLE_PREDICATE_REASON`
 * (web-client/src/lib/organize/rule-model.ts).
 */
const UNCOUNTABLE =
	"Can't count matches — “has the words” reads message bodies, which only a saved rule does.";

/** The editor state, threaded into whichever shell the story renders. */
function useSearchRuleEditor(
	initialRule: FilterRule,
	previewOverride?: PreviewCount,
) {
	const [rule, setRule] = useState<FilterRule>(initialRule);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>();
	const derivedPreview = useMemo<PreviewCount>(
		() => READY(rule.clauses.length * 18),
		[rule],
	);
	return {
		rule,
		folders: demoFolders,
		clauseEdit,
		preview: previewOverride ?? derivedPreview,
		semanticAvailable: false,
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
		onRemoveClause: (clauseId: string) =>
			setRule((r) => ({
				...r,
				clauses: r.clauses.filter((c) => c.id !== clauseId),
			})),
		onChangeDraftField: (field: ClauseField) =>
			setClauseEdit((e) => (e ? { ...e, draft: { ...e.draft, field } } : e)),
		onChangeDraftValue: (value: string) =>
			setClauseEdit((e) => (e ? { ...e, draft: { ...e.draft, value } } : e)),
		onSubmitClause: () =>
			setClauseEdit((edit) => {
				if (!edit) return undefined;
				setRule((r) => ({
					...r,
					clauses: [
						...r.clauses,
						{
							id: `c-${Date.now()}`,
							field: edit.draft.field,
							value: edit.draft.value,
						},
					],
				}));
				return undefined;
			}),
		onCancelClause: () => setClauseEdit(undefined),
		onChangeMatchOperator: (matchOperator: FilterRule["matchOperator"]) =>
			setRule((r) => ({ ...r, matchOperator })),
		onChangeMove: (moveMailboxId: string) =>
			setRule((r) => ({ ...r, moveMailboxId: moveMailboxId || undefined })),
		onChangeScope: (scope: FilterRule["scope"]) =>
			setRule((r) => ({ ...r, scope })),
		onChangeName: (name: string) => setRule((r) => ({ ...r, name })),
		onChangeUntil: (until: string) => setRule((r) => ({ ...r, until })),
		onCommit: () => {},
	};
}

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

const notice = (n: SearchConversionNotice) => (
	<SearchConversionNoticeView notice={n} />
);

function DesktopStory({
	rule,
	conversionNotice,
	preview,
}: {
	rule: FilterRule;
	conversionNotice: SearchConversionNotice;
	preview?: PreviewCount;
}) {
	const editor = useSearchRuleEditor(rule, preview);
	return (
		<div className="h-dvh w-full bg-canvas">
			<FilterRuleDialog
				open
				onClose={() => {}}
				notice={notice(conversionNotice)}
				{...editor}
			/>
		</div>
	);
}

function MobileStory({
	rule,
	conversionNotice,
	preview,
}: {
	rule: FilterRule;
	conversionNotice: SearchConversionNotice;
	preview?: PreviewCount;
}) {
	const editor = useSearchRuleEditor(rule, preview);
	return (
		<PhoneFrame>
			<FilterRuleSheet
				open
				onClose={() => {}}
				notice={notice(conversionNotice)}
				{...editor}
			/>
		</PhoneFrame>
	);
}

/** A plain search: literal terms became a HasWords clause, nothing dropped. */
export const DesktopLiteralTerms: Story = {
	render: () => (
		<DesktopStory
			rule={searchRule([
				{ id: "c1", field: "HasWords", value: "quarterly report" },
			])}
			conversionNotice={{}}
		/>
	),
};

/** A folder-scoped search: the scope cannot ride into the filter and is stated. */
export const DesktopFolderScopedOut: Story = {
	render: () => (
		<DesktopStory
			rule={searchRule([{ id: "c1", field: "HasWords", value: "receipts" }])}
			conversionNotice={{ scopedOutFolder: "Archive" }}
		/>
	),
};

/** A search with attachment/unread facets that are not filter conditions. */
export const DesktopDroppedFacets: Story = {
	render: () => (
		<DesktopStory
			rule={searchRule([
				{ id: "c1", field: "From", value: "alerts@github.com" },
				{ id: "c2", field: "HasWords", value: "deploy" },
			])}
			conversionNotice={{ droppedFacets: ["Has attachment", "Unread"] }}
		/>
	),
};

/** A self-host deployment: the words are kept literally, the semantic reach dropped. */
export const DesktopDroppedSemantic: Story = {
	render: () => (
		<DesktopStory
			rule={searchRule([
				{ id: "c1", field: "HasWords", value: "things like this" },
			])}
			conversionNotice={{ droppedSemantic: true }}
		/>
	),
};

/**
 * What "Make this a filter" actually opens on for a search by words. The
 * `HasWords` clause reads message bodies, which only a saved rule does, so
 * there is no count to show — the count region says so, the rule is fully
 * editable, and "Keep doing this" saves. Only the one-time apply is held, with
 * its own reason. The editor opening at all is the point: this used to be a
 * failed count and a dead-end "Try again".
 */
export const DesktopUncountableWords: Story = {
	render: () => (
		<DesktopStory
			rule={searchRule([
				{ id: "c1", field: "HasWords", value: "quarterly report" },
			])}
			conversionNotice={{}}
			preview={{ status: "error", reason: UNCOUNTABLE }}
		/>
	),
};

/** The same uncountable rule on the mobile sheet. */
export const MobileUncountableWords: Story = {
	render: () => (
		<MobileStory
			rule={{
				...searchRule([{ id: "c1", field: "HasWords", value: "receipts" }]),
				scope: "once",
			}}
			conversionNotice={{}}
			preview={{ status: "error", reason: UNCOUNTABLE }}
		/>
	),
};

/** Everything the search carried that the filter cannot, on the mobile sheet. */
export const MobileEverythingDropped: Story = {
	render: () => (
		<MobileStory
			rule={searchRule([
				{ id: "c1", field: "From", value: "alerts@github.com" },
				{ id: "c2", field: "HasWords", value: "invoice" },
			])}
			conversionNotice={{
				scopedOutFolder: "Archive",
				droppedFacets: ["Has attachment", "Before 2026-01-01"],
				droppedSemantic: true,
			}}
		/>
	),
};
