import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { ClauseChip, ClauseEditor, WidenChip } from "./filter-clause-chip.js";
import { FilterPreviewCount } from "./filter-preview-count.js";
import {
	type ClauseField,
	clauseFieldLabel,
	demoClauseSuggestions,
	demoFolders,
	demoLabels,
	demoRule,
	demoSenderFallbackRule,
	demoSubjectPrefillRule,
	demoVocabularyRule,
	type FilterRule,
	type LabelOption,
	type PreviewCount,
	type RuleClause,
	type RuleMatchMode,
} from "./filter-rule.js";
import {
	type ClauseEditState,
	FilterRuleEditor,
	type FilterRuleEditorProps,
} from "./filter-rule-editor.js";
import type { FolderTreeNode } from "./folder-tree-picker.js";

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
 * remove clauses, toggle the operator and scope, watch the count follow. The
 * count settles instantly here so the commit stays usable; the loading and
 * recounting states have their own stories. State is local; no app, no network.
 */
function LiveEditor({
	initialRule,
	semanticAvailable = true,
	initialMatchMode,
	propertyRule,
	labels = demoLabels,
	initialClauseEdit,
	onCreateFolder,
	onCreateLabel,
}: {
	initialRule: FilterRule;
	semanticAvailable?: boolean;
	/** Offers the match-mode control; omit to render the editor without one. */
	initialMatchMode?: RuleMatchMode;
	/** Opens on the clause form, for the stories about editing a clause. */
	initialClauseEdit?: ClauseEditState;
	/** What the properties mode prefills — the app derives this from the
	 *  selection's senders and subjects. */
	propertyRule?: FilterRule;
	labels?: LabelOption[];
	onCreateFolder?: (
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) => Promise<FolderTreeNode>;
	onCreateLabel?: (name: string) => Promise<LabelOption>;
}) {
	const [rule, setRule] = useState<FilterRule>(initialRule);
	const [matchMode, setMatchMode] = useState(initialMatchMode);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState | undefined>(
		initialClauseEdit,
	);

	const preview = useMemo<PreviewCount>(
		() => READY(rule.clauses.length * 23 + (rule.widen ? 40 : 0)),
		[rule],
	);

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
		},
		onCancelClause: () => setClauseEdit(undefined),
		onAddWiden: () => {
			setRule((r) => ({ ...r, widen: { anchorCount: 2 } }));
		},
		onRemoveWiden: () => {
			setRule((r) => ({ ...r, widen: undefined }));
		},
		onChangeMatchOperator: (matchOperator) => {
			setRule((r) => ({ ...r, matchOperator }));
		},
		onChangeMatchMode: (mode) => {
			setMatchMode(mode);
			// The app rebuilds only the matchers, keeping the action and scope; the
			// story does the same with its two fixture rules.
			setRule((r) =>
				mode === "properties"
					? {
							...r,
							clauses: (propertyRule ?? demoSenderFallbackRule).clauses,
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
		onChangeMove: (moveMailboxId) =>
			setRule((r) => ({ ...r, moveMailboxId: moveMailboxId || undefined })),
		onChangeLabel: (labelId) =>
			setRule((r) => ({ ...r, labelId: labelId || undefined })),
		onChangeScope: (scope) => setRule((r) => ({ ...r, scope })),
		onChangeName: (name) => setRule((r) => ({ ...r, name })),
		onChangeUntil: (until) => setRule((r) => ({ ...r, until })),
	};

	return (
		<FilterRuleEditor
			rule={rule}
			folders={demoFolders}
			labels={labels}
			preview={preview}
			semanticAvailable={semanticAvailable}
			matchMode={matchMode}
			clauseEdit={clauseEdit}
			clauseSuggestions={
				clauseEdit
					? demoClauseSuggestions(
							clauseEdit.draft.field,
							clauseEdit.draft.value,
						)
					: undefined
			}
			onCreateFolder={onCreateFolder}
			onCreateLabel={onCreateLabel}
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

/**
 * The Organize surface, where the rule can be matched either way. It opens on
 * "Anything similar" — semantic is still the default — and switching to
 * "Its properties" drops the widen for the clauses derived from the messages
 * that were selected. Switch back and the widen returns.
 */
export const MatchModeSemanticDefault: Story = {
	render: () => (
		<LiveEditor
			initialRule={{ ...demoRule, clauses: [] }}
			initialMatchMode="similar"
			propertyRule={demoSenderFallbackRule}
		/>
	),
};

/**
 * Properties matching with one sender behind the whole selection — a single
 * `From` chip, no semantics involved. Editable like any other chip.
 */
export const MatchOnSenderProperty: Story = {
	render: () => (
		<LiveEditor
			initialRule={{
				...demoSenderFallbackRule,
				clauses: demoSenderFallbackRule.clauses.slice(0, 1),
				scope: "once",
				name: "",
			}}
			initialMatchMode="properties"
			propertyRule={demoSenderFallbackRule}
		/>
	),
};

/**
 * Properties matching when the senders differ: the prefill falls back to the
 * part the selected subjects share, so the rule still starts somewhere useful.
 */
export const MatchOnSubjectProperty: Story = {
	render: () => (
		<LiveEditor
			initialRule={demoSubjectPrefillRule}
			initialMatchMode="properties"
			propertyRule={demoSubjectPrefillRule}
		/>
	),
};

/**
 * Adding a `From` clause, with the value field offering what it knows: the
 * senders of the messages that were selected lead the list — marked "selected",
 * and there before a key is pressed — followed by other known addresses. Typing
 * narrows it; anything typed still stands, match or no match.
 */
export const ClauseValueSuggestions: Story = {
	render: () => (
		<LiveEditor
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
			initialClauseEdit={{ mode: "add", draft: { field: "From", value: "" } }}
		/>
	),
};

/**
 * The same field on a `Domain` clause: the addresses collapse to registrable
 * domains, so the value offered is exactly the string the matcher compares.
 */
export const DomainClauseSuggestions: Story = {
	render: () => (
		<LiveEditor
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
			initialClauseEdit={{
				mode: "add",
				draft: { field: "FromDomain", value: "" },
			}}
		/>
	),
};

/**
 * Typing something no known sender matches. The list simply goes away — no
 * empty panel, no warning, no block on the value. A clause for an address that
 * has not written yet is a legitimate rule.
 */
export const ClauseValueNoMatches: Story = {
	render: () => (
		<LiveEditor
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
			initialClauseEdit={{
				mode: "add",
				draft: { field: "From", value: "someone@nowhere.test" },
			}}
		/>
	),
};

/**
 * A free-text field is left alone: `Subject` has nothing to draw suggestions
 * from, so it stays the plain box it was.
 */
export const SubjectClauseStaysFreeText: Story = {
	render: () => (
		<LiveEditor
			initialRule={{ ...demoRule, widen: undefined }}
			semanticAvailable={false}
			initialClauseEdit={{
				mode: "add",
				draft: { field: "Subject", value: "receipt" },
			}}
		/>
	),
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

const clickText = (canvasElement: HTMLElement, label: string) => {
	Array.from(canvasElement.querySelectorAll<HTMLButtonElement>("button"))
		.find((button) => button.textContent?.trim() === label)
		?.click();
};

const clickAriaLabel = (canvasElement: HTMLElement, label: string) => {
	canvasElement.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();
};

const setInputValue = (input: HTMLInputElement, value: string) => {
	Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
};

/** The create form's name field, found by the label the kit gives it. */
const typeFolderName = (canvasElement: HTMLElement, name: string) => {
	const label = Array.from(canvasElement.querySelectorAll("label")).find(
		(node) => node.textContent?.trim() === "Folder name",
	);
	const id = label?.getAttribute("for");
	const input = id
		? canvasElement.querySelector<HTMLInputElement>(`input[id="${id}"]`)
		: null;
	if (input) setInputValue(input, name);
};

/** Opens the destination tree, which the field keeps closed until it is asked for. */
const openDestinationTree = async (canvasElement: HTMLElement) => {
	clickText(canvasElement, "Choose a folder");
	await tick();
};

/** Opens a folder in the tree; tapping it both picks it and reveals its children. */
const openFolder = async (canvasElement: HTMLElement, label: string) => {
	clickAriaLabel(canvasElement, `Move to ${label}`);
	await tick();
};

/**
 * Drive the destination tree into its create form and submit it. `inside` names
 * the folder the new one is made in; omitted makes it at the top level. Used by
 * the pending and error stories below so each lands in the state it documents.
 */
async function createFolderFromTree(
	canvasElement: HTMLElement,
	folderName: string,
	inside?: string,
) {
	await openDestinationTree(canvasElement);
	if (inside) {
		await openFolder(canvasElement, inside);
		clickAriaLabel(canvasElement, `New folder inside ${inside}`);
	} else {
		clickAriaLabel(canvasElement, "New folder");
	}
	await tick();
	typeFolderName(canvasElement, folderName);
	await tick();
	clickText(canvasElement, "Create folder");
}

let newFolderSeq = 0;
const mockCreateFolder = (
	name: string,
	parentPath: string,
): Promise<FolderTreeNode> =>
	new Promise((resolve) => {
		newFolderSeq += 1;
		setTimeout(
			() =>
				resolve({
					id: `mbx-new-${newFolderSeq}`,
					label: name,
					path: parentPath ? `${parentPath}/${name}` : name,
				}),
			400,
		);
	});

/**
 * The destination is chosen from the same browsable tree every other picker
 * uses: open a folder to see what is inside it, filter to narrow, and make a
 * new one where you are looking.
 */
export const DestinationTree: Story = {
	name: "Destination — browse the folder tree",
	render: () => (
		<LiveEditor initialRule={demoRule} onCreateFolder={mockCreateFolder} />
	),
	play: async ({ canvasElement }) => {
		await openDestinationTree(canvasElement);
	},
};

/**
 * Two folders named Receipts, one at the top level and one inside Travel. The
 * tree tells them apart by where they sit; a list of leaf names could not.
 */
export const DestinationNestedFolders: Story = {
	name: "Destination — a nested folder and its same-named sibling",
	render: () => (
		<LiveEditor initialRule={demoRule} onCreateFolder={mockCreateFolder} />
	),
	play: async ({ canvasElement }) => {
		await openDestinationTree(canvasElement);
		await openFolder(canvasElement, "Travel");
	},
};

/**
 * A new folder is made inside the folder the tree is looking at, so a filter can
 * point at `Travel/Car hire` without leaving the editor.
 */
export const NewFolderInsideAnother: Story = {
	name: "New folder — inside the folder you opened",
	render: () => (
		<LiveEditor initialRule={demoRule} onCreateFolder={mockCreateFolder} />
	),
	play: async ({ canvasElement }) => {
		await openDestinationTree(canvasElement);
		await openFolder(canvasElement, "Travel");
		clickAriaLabel(canvasElement, "New folder inside Travel");
		await tick();
		typeFolderName(canvasElement, "Car hire");
	},
};

/** Mirrors the web-client wait's honest timeout copy. */
const TIMEOUT_MESSAGE =
	"The folder was created but the mail server hasn't confirmed it yet, so nothing was attached to it. It's in your folder list — try again in a moment.";

const neverResolvesCreateFolder = (): Promise<FolderTreeNode> =>
	new Promise<FolderTreeNode>(() => undefined);

const rejectingCreateFolder =
	(message: string) => (): Promise<FolderTreeNode> =>
		Promise.reject(new Error(message));

/** Rejects the first attempt, resolves the retry — the resume the hook performs. */
const failThenSucceedCreateFolder = () => {
	let attempts = 0;
	return (name: string, parentPath: string): Promise<FolderTreeNode> => {
		attempts += 1;
		return attempts === 1
			? Promise.reject(new Error(TIMEOUT_MESSAGE))
			: Promise.resolve({
					id: "mbx-created",
					label: name,
					path: parentPath ? `${parentPath}/${name}` : name,
				});
	};
};

/** Never resolves on its own; rejects with an AbortError when the signal aborts. */
const abortAwareCreateFolder = (
	_name: string,
	_parentPath: string,
	signal?: AbortSignal,
): Promise<FolderTreeNode> =>
	new Promise<FolderTreeNode>((_resolve, reject) => {
		signal?.addEventListener("abort", () =>
			reject(new DOMException("Aborted", "AbortError")),
		);
	});

/**
 * The folder is a dependent write for the filter, so creating it waits for the
 * mail server to confirm the folder before it can be picked as the destination.
 * The wait is held in the form, which refuses a second submit while it runs.
 */
export const NewFolderCreating: Story = {
	name: "New folder — creating (waiting for the server)",
	render: () => (
		<LiveEditor
			initialRule={demoRule}
			onCreateFolder={neverResolvesCreateFolder}
		/>
	),
	play: async ({ canvasElement }) => {
		await createFolderFromTree(canvasElement, "Receipts");
	},
};

/**
 * The folder create failed on the mail server. The rule is not committed against
 * a folder that does not exist: the error is surfaced inline with the create form
 * still open, so the create can be retried or cancelled.
 */
export const NewFolderCreateFailed: Story = {
	name: "New folder — create failed (retry / cancel)",
	render: () => (
		<LiveEditor
			initialRule={demoRule}
			onCreateFolder={rejectingCreateFolder(
				"The folder couldn't be created on the mail server. Please try again.",
			)}
		/>
	),
	play: async ({ canvasElement }) => {
		await createFolderFromTree(canvasElement, "Receipts");
	},
};

/**
 * The folder create was never confirmed within the wait bound. Distinct from a
 * hard failure — the message names the timeout — and, like a failure, leaves no
 * folder selected, so no filter is written against it.
 */
export const NewFolderCreateTimedOut: Story = {
	name: "New folder — create timed out (retry / cancel)",
	render: () => (
		<LiveEditor
			initialRule={demoRule}
			onCreateFolder={rejectingCreateFolder(TIMEOUT_MESSAGE)}
		/>
	),
	play: async ({ canvasElement }) => {
		await createFolderFromTree(canvasElement, "Receipts");
	},
};

/**
 * Retry is a resume: the first attempt times out (the folder was made but not yet
 * confirmed), and pressing "Create folder" again with the same name resolves —
 * the hook re-waits on the folder it already made rather than re-creating it, so
 * the retry the failure message points at actually works.
 */
export const NewFolderCreateRetrySucceeds: Story = {
	name: "New folder — retry resumes and succeeds",
	render: () => (
		<LiveEditor
			initialRule={demoRule}
			onCreateFolder={failThenSucceedCreateFolder()}
		/>
	),
	play: async ({ canvasElement }) => {
		await createFolderFromTree(canvasElement, "Receipts", "Travel");
		await tick();
		clickText(canvasElement, "Create folder");
	},
};

/**
 * Cancelling while the create is in flight aborts the wait: the create promise
 * rejects with an AbortError the form swallows, so no destination binds after
 * the user backed out — the form just closes.
 */
export const NewFolderCreateCancelledMidWait: Story = {
	name: "New folder — cancel aborts the wait",
	render: () => (
		<LiveEditor
			initialRule={demoRule}
			onCreateFolder={abortAwareCreateFolder}
		/>
	),
	play: async ({ canvasElement }) => {
		await createFolderFromTree(canvasElement, "Receipts");
		await tick();
		clickText(canvasElement, "Cancel");
	},
};

/** No labels exist yet in the account — the select offers only "No label". */
export const NoLabels: Story = {
	render: () => <LiveEditor initialRule={demoRule} labels={[]} />,
};

/** A rule that already applies a label — the chip renders next to the select. */
export const WithLabelSelected: Story = {
	render: () => (
		<LiveEditor initialRule={{ ...demoRule, labelId: "lbl-receipts" }} />
	),
};

/** Many labels in the account — the select scrolls rather than the layout growing. */
export const ManyLabels: Story = {
	render: () => (
		<LiveEditor
			initialRule={demoRule}
			labels={Array.from({ length: 20 }, (_, i) => ({
				id: `lbl-${i}`,
				name: `Label ${i + 1}`,
				color: demoLabels[i % demoLabels.length].color,
			}))}
		/>
	),
};

/** A long label name truncates in the chip rather than overflowing the row. */
export const LongLabelNames: Story = {
	render: () => (
		<LiveEditor
			initialRule={{ ...demoRule, labelId: "lbl-long" }}
			labels={[
				{
					id: "lbl-long",
					name: "Quarterly compliance filings that need a second look",
					color: "Purple",
				},
				...demoLabels,
			]}
		/>
	),
};

let newLabelSeq = 0;
const mockCreateLabel = (name: string): Promise<LabelOption> =>
	new Promise((resolve) => {
		newLabelSeq += 1;
		setTimeout(
			() => resolve({ id: `lbl-new-${newLabelSeq}`, name, color: "Default" }),
			400,
		);
	});

/**
 * The label select offers a "＋ New label…" option because `onCreateLabel` is
 * wired (issue #26). Choosing it reveals a name field; on resolve the label is
 * added to the select and picked as the action. Without the prop the option
 * never shows — the editor stays data-agnostic.
 */
export const WithNewLabelOption: Story = {
	render: () => (
		<LiveEditor initialRule={demoRule} onCreateLabel={mockCreateLabel} />
	),
};

const mockCreateLabelFailure = (): Promise<LabelOption> =>
	new Promise((_resolve, reject) => {
		setTimeout(() => reject(new Error("That name is already taken.")), 400);
	});

/** Creating a label from the picker can fail — the field stays open with the reason. */
export const LabelCreateError: Story = {
	render: () => (
		<LiveEditor initialRule={demoRule} onCreateLabel={mockCreateLabelFailure} />
	),
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

/**
 * Editing a persisted filter (RFC 038 D6, reader #266): scope and expiry stay
 * live and editable — a standing filter can move to "until a date" and back,
 * or its date can change. The semantic anchor is the one thing fixed at
 * creation: the widen chip renders display-only with a one-line note, and
 * "Just once" drops out of the scope toggle since no saved filter can hold it.
 */
export const AnchorLocked: Story = {
	args: {
		rule: {
			...demoRule,
			scope: "until",
			until: "2027-09-01",
			name: "Conference",
		},
		folders: demoFolders,
		preview: READY(31),
		semanticAvailable: false,
		anchorLocked: true,
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

/** The live count while it recomputes — the commit waits for it to settle. */
export const PreviewLoading: Story = {
	args: {
		rule: demoRule,
		folders: demoFolders,
		preview: { status: "loading" },
		semanticAvailable: true,
	},
};

/**
 * The previewed set changed under the rule — recounting, never blank, and the
 * "Save rule" button is held disabled until the count that will be applied is
 * the count on screen (RFC 038's previewed-set-equals-applied-set contract).
 */
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
