import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { ClauseChip, ClauseEditor, WidenChip } from "./filter-clause-chip.js";
import { FilterPreviewCount } from "./filter-preview-count.js";
import {
	type ClauseField,
	clauseFieldLabel,
	demoFolders,
	demoRule,
	demoSenderFallbackRule,
	demoVocabularyRule,
	type FilterRule,
	type PreviewCount,
	type RuleClause,
} from "./filter-rule.js";
import {
	type ClauseEditState,
	FilterRuleEditor,
	type FilterRuleEditorProps,
} from "./filter-rule-editor.js";

const meta: Meta<typeof FilterRuleEditor> = {
	title: "FilterRuleEditor",
	component: FilterRuleEditor,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-md rounded-xl border border-line bg-surface">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof FilterRuleEditor>;

const READY = (count: number, stale?: boolean): PreviewCount => ({
	status: "ready",
	count,
	stale,
});

/**
 * A fully wired editor so every affordance is live in the story — add, edit and
 * remove clauses, toggle the operator and scope, watch the count go stale on a
 * change. State is local to the story; no app, no network.
 */
function LiveEditor({
	initialRule,
	semanticAvailable = true,
}: {
	initialRule: FilterRule;
	semanticAvailable?: boolean;
}) {
	const [rule, setRule] = useState<FilterRule>(initialRule);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>();
	const [dirtyAt, setDirtyAt] = useState(0);

	const preview = useMemo<PreviewCount>(
		() => READY(rule.clauses.length * 23 + (rule.widen ? 40 : 0), dirtyAt > 0),
		[rule, dirtyAt],
	);

	const touch = () => setDirtyAt((n) => n + 1);

	const handlers: Partial<FilterRuleEditorProps> = {
		onStartAddClause: () =>
			setClauseEdit({ mode: "add", draft: { field: "From", value: "" } }),
		onStartEditClause: (clauseId) => {
			const clause = rule.clauses.find((c) => c.id === clauseId);
			if (!clause) return;
			setClauseEdit({
				mode: "edit",
				clauseId,
				draft: { field: clause.field, value: clause.value },
			});
		},
		onRemoveClause: (clauseId) => {
			setRule((r) => ({
				...r,
				clauses: r.clauses.filter((c) => c.id !== clauseId),
			}));
			touch();
		},
		onChangeDraftField: (field) =>
			setClauseEdit((e) => (e ? { ...e, draft: { ...e.draft, field } } : e)),
		onChangeDraftValue: (value) =>
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
			touch();
		},
		onCancelClause: () => setClauseEdit(undefined),
		onAddWiden: () => {
			setRule((r) => ({ ...r, widen: { anchorCount: 2 } }));
			touch();
		},
		onRemoveWiden: () => {
			setRule((r) => ({ ...r, widen: undefined }));
			touch();
		},
		onChangeMatchOperator: (matchOperator) => {
			setRule((r) => ({ ...r, matchOperator }));
			touch();
		},
		onChangeMove: (moveMailboxId) =>
			setRule((r) => ({ ...r, moveMailboxId: moveMailboxId || undefined })),
		onChangeScope: (scope) => setRule((r) => ({ ...r, scope })),
		onChangeName: (name) => setRule((r) => ({ ...r, name })),
		onChangeUntil: (until) => setRule((r) => ({ ...r, until })),
	};

	return (
		<FilterRuleEditor
			rule={rule}
			folders={demoFolders}
			preview={preview}
			semanticAvailable={semanticAvailable}
			clauseEdit={clauseEdit}
			onCommit={() => {}}
			onCancel={() => {}}
			{...handlers}
		/>
	);
}

/** The full editor, interactive — the shape ticket B and the app consume. */
export const Interactive: Story = {
	render: () => <LiveEditor initialRule={demoRule} />,
};

/** Literal clauses joined with "or", including the ticket-B ListId and FromDomain fields. */
export const AnyOfTheseClauses: Story = {
	render: () => <LiveEditor initialRule={demoVocabularyRule} />,
};

/** A one-time rule — no name, no widen, the commit reads "Apply now". */
export const OneTimeMove: Story = {
	args: {
		rule: {
			clauses: [{ id: "c1", field: "Subject", value: "receipt" }],
			matchOperator: "all",
			moveMailboxId: "mbx-receipts",
			scope: "once",
		},
		folders: demoFolders,
		preview: READY(12),
	},
};

/** Standing scope with a widen — the "keep doing this" rule. */
export const StandingWithWiden: Story = {
	args: {
		rule: demoRule,
		folders: demoFolders,
		preview: READY(47),
		semanticAvailable: true,
	},
};

/** Timed scope — the name and a date the rule stops on. */
export const UntilADate: Story = {
	args: {
		rule: {
			...demoRule,
			scope: "until",
			until: "2026-09-01",
			name: "Conference",
		},
		folders: demoFolders,
		preview: READY(31),
		semanticAvailable: true,
	},
};

/**
 * The sender-fallback (#251) as chips: the derived From clauses are ordinary
 * visible, editable chips, not an invisible substitution.
 */
export const SenderFallbackChips: Story = {
	render: () => (
		<LiveEditor
			initialRule={demoSenderFallbackRule}
			semanticAvailable={false}
		/>
	),
};

/**
 * The deployment cannot serve the widen (RFC 038 D4): the "…and similar" add is
 * not offered and the rule matches by its literal clauses only.
 */
export const SemanticUnavailable: Story = {
	args: {
		rule: { ...demoRule, widen: undefined },
		folders: demoFolders,
		preview: READY(24),
		semanticAvailable: false,
	},
};

/**
 * A standing rule that carries an anchor this deployment cannot evaluate — the
 * widen chip lists as inactive and nothing claims similarity is running.
 */
export const DegradedStandingWiden: Story = {
	args: {
		rule: { ...demoRule, widen: { anchorCount: 2, inactive: true } },
		folders: demoFolders,
		preview: READY(19),
		semanticAvailable: false,
	},
};

/** Nothing to match yet — the commit says why it is blocked. */
export const BlockedEmpty: Story = {
	args: {
		rule: {
			clauses: [],
			matchOperator: "all",
			scope: "once",
		},
		folders: demoFolders,
		preview: READY(0),
		semanticAvailable: true,
	},
};

/** The live count while it recomputes. */
export const PreviewLoading: Story = {
	args: {
		rule: demoRule,
		folders: demoFolders,
		preview: { status: "loading" },
		semanticAvailable: true,
	},
};

/** The previewed set changed under the rule — recounting, never blank. */
export const PreviewStale: Story = {
	args: {
		rule: demoRule,
		folders: demoFolders,
		preview: READY(47, true),
		semanticAvailable: true,
	},
};

/** The preview failed — the count region raises it, the editor stays usable. */
export const PreviewError: Story = {
	args: {
		rule: demoRule,
		folders: demoFolders,
		preview: { status: "error", reason: "Couldn't reach the server to count." },
		semanticAvailable: true,
	},
};

type ChipStory = StoryObj;

/** Every clause and widen chip in isolation, including edit and inactive states. */
export const ChipGallery: ChipStory = {
	render: () => {
		const fields: ClauseField[] = [
			"From",
			"Subject",
			"HasWords",
			"ListId",
			"FromDomain",
		];
		return (
			<div className="space-y-4 p-4">
				<div className="flex flex-wrap gap-2">
					{fields.map((field) => (
						<ClauseChip
							key={field}
							clause={{ id: field, field, value: clauseFieldLabel(field) }}
							onEdit={() => {}}
							onRemove={() => {}}
						/>
					))}
				</div>
				<div className="flex flex-wrap gap-2">
					<ClauseChip
						clause={{
							id: "d",
							field: "From",
							value: "receipts@stripe.com",
							derived: true,
						}}
						onEdit={() => {}}
						onRemove={() => {}}
					/>
					<WidenChip widen={{ anchorCount: 2 }} onRemove={() => {}} />
					<WidenChip widen={{ anchorCount: 2, inactive: true }} />
				</div>
				<ClauseEditor
					draft={{ field: "ListId", value: "python-dev.python.org" }}
					mode="edit"
					onChangeField={() => {}}
					onChangeValue={() => {}}
					onSubmit={() => {}}
					onCancel={() => {}}
				/>
				<div className="space-y-2">
					<FilterPreviewCount preview={{ status: "loading" }} />
					<FilterPreviewCount preview={READY(0)} />
					<FilterPreviewCount preview={READY(412)} />
					<FilterPreviewCount preview={READY(47, true)} />
					<FilterPreviewCount
						preview={{ status: "error", reason: "Couldn't count." }}
					/>
				</div>
			</div>
		);
	},
};
