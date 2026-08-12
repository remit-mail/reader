import {
	type ClauseEditState,
	demoClauseSuggestions,
	derivePropertyClauses,
	deriveSenderClauses,
	dominantSender,
	type EnvelopeAddress,
	type FolderTreeNode,
	inboxFilterConfig,
	isConvertible,
	type MatchCount,
	type MatchMode,
	type MatchOperator,
	makeFilterBlockedCopy,
	type RuleClause,
	type RuleScope,
	type RunState,
	type SampleEmptyReason,
	type SearchChip,
	type SearchConversion,
	type SelectionRestriction,
	SelectionWizard,
	type StepId,
	searchConversionNotice,
	senderLabel,
	stepBlockedReason,
	stepIndex,
	stepsFor,
	suggestRuleName,
	type ThreadRowData,
	UNCOUNTABLE_PREDICATE_REASON,
	type Verb,
	type WizardDraft,
	wizardScopeFor,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	FACETS_ONLY_CONVERSION,
	PLAIN_CONVERSION,
	RICH_CONVERSION,
	SELECTION_FOLDERS,
	SELECTION_RECEIPTS_SAMPLE,
	SELECTION_SAMPLE,
	SELECTION_SEARCH_SAMPLE,
	type SelectionMessage,
} from "../fixtures/selection-messages.js";
import { q3Intelligence, q3Thread } from "../fixtures/workspace.js";
import {
	DESKTOP_WIDTH,
	TABLET_WIDTH,
	WIDE_PHONE_WIDTH,
} from "../lib/story-frame.js";
import { MailShell } from "../screens/mail-shell.js";

/** The list rows the wizard is opened from, as the shell's list pane takes them. */
const toRow = (message: SelectionMessage): ThreadRowData => ({
	id: message.id,
	fromName: message.sender,
	fromEmail: message.email,
	subject: message.subject,
	snippet: message.preview,
	timeLabel: message.date,
});

/* ------------------------------------------------------------------ */
/* The driver — the answers, held for the wizard to render             */
/* ------------------------------------------------------------------ */

/** The wizard as a story opens it: a verb, and optionally a state to land on. */
interface WizardEntry {
	verb: Verb;
	/** Enter by converting the query rather than by ticking rows. */
	fromSearch?: boolean;
	startAt?: StepId;
	startMode?: MatchMode;
	/**
	 * The list escalated the selection to a predicate — every message matching
	 * the query rather than the ticked rows. The wizard is offered no doors over
	 * it: the predicate is already the match.
	 */
	escalatedScope?: string;
	/** The server's count of that predicate, which the review states. */
	escalatedTotal?: number;
	scope?: RuleScope;
	semanticUnavailable?: boolean;
	/** What the mail server said when the widen was asked to run and failed. */
	semanticError?: string;
	/**
	 * The selection spans more than one account, or more than one folder of a
	 * single account. Either way no folder and no rule can be reached, and the
	 * steps state the one that applies (#525).
	 */
	restriction?: SelectionRestriction;
	runState?: RunState;
	/**
	 * Why the commit never started, when sending the same one again cannot get
	 * past it. The run screen states it and offers no retry (#522).
	 */
	runFailureReason?: string;
	/** How many the mail server rejected beyond the ones the run can name. */
	failedBeyondNamed?: number;
	/** The property door carries a body-text clause, which has no count to show. */
	bodyTextClause?: boolean;
	sampleEmpty?: SampleEmptyReason;
	/** The rows are still arriving, which is not the same answer as no rows. */
	sampleLoading?: boolean;
	/** How the mail server answers a folder create on the folder step. */
	folderCreate?: "confirms" | "never confirms" | "fails";
}

const withIds = (
	clauses: Omit<RuleClause, "id">[],
	prefix: string,
): RuleClause[] =>
	clauses.map((clause, index) => ({
		...clause,
		id: `${prefix}-${index}`,
		derived: true,
	}));

const envelopesOf = (messages: SelectionMessage[]): EnvelopeAddress[] =>
	messages.map((message) => ({
		normalizedEmail: message.email,
		displayName: message.sender,
	}));

const MAILBOXES: FolderTreeNode[] = SELECTION_FOLDERS.map((path) => ({
	id: `mbx-${path.toLowerCase().replace(/\//g, "-")}`,
	label: path.slice(path.lastIndexOf("/") + 1),
	path,
}));

/** A create that resolves only once the mail server has confirmed the folder. */
const folderCreators: Record<
	NonNullable<WizardEntry["folderCreate"]>,
	(
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) => Promise<FolderTreeNode>
> = {
	confirms: (name, parentPath) =>
		Promise.resolve({
			id: `mbx-${name.toLowerCase()}`,
			label: name,
			path: parentPath ? `${parentPath}/${name}` : name,
		}),
	"never confirms": (_name, _parentPath, signal) =>
		new Promise((_resolve, reject) => {
			signal?.addEventListener("abort", () =>
				reject(new DOMException("Aborted", "AbortError")),
			);
		}),
	fails: () =>
		Promise.reject(
			new Error("The mail server refused the folder. Please try again."),
		),
};

/**
 * The answers a story holds while the wizard renders them. The app holds the
 * same answers against its own hooks; nothing here is a second copy of a screen.
 */
function WizardDriver({
	entry,
	selected,
	results,
	conversion,
	onExit,
}: {
	entry: WizardEntry;
	selected: SelectionMessage[];
	results: SelectionMessage[];
	conversion?: SearchConversion;
	onExit: () => void;
}) {
	const fromSearch = Boolean(entry.fromSearch && conversion);
	const senders = selected.map((message) => message.email);

	const escalated = entry.escalatedScope;
	const [mode, setMode] = useState<MatchMode>(() => {
		if (escalated) return "escalated";
		if (fromSearch) return "properties";
		if (entry.startMode) return entry.startMode;
		return entry.startAt === "properties" ? "properties" : "selected";
	});
	const [clauses, setClauses] = useState<RuleClause[]>(() => {
		if (fromSearch && conversion) {
			return conversion.clauses.map((clause, index) => ({
				...clause,
				id: `search-${index}`,
			}));
		}
		if (entry.bodyTextClause) {
			return [{ id: "body-text", field: "HasWords", value: "invoice" }];
		}
		return withIds(
			derivePropertyClauses(
				senders,
				selected.map((message) => message.subject),
			),
			"seed",
		);
	});
	const [matchOperator, setMatchOperator] = useState<MatchOperator>(
		conversion?.matchOperator ?? "all",
	);
	const [clauseEdit, setClauseEdit] = useState<ClauseEditState>();
	const [mailboxes, setMailboxes] = useState<FolderTreeNode[]>(MAILBOXES);
	const [mailboxId, setMailboxId] = useState<string>();
	const [scope, setScope] = useState<RuleScope | undefined>(
		entry.scope ?? (entry.startAt === "name" ? "standing" : undefined),
	);
	const [until, setUntil] = useState("");
	const [typedName, setTypedName] = useState<string>();
	const [semanticFallbackTaken, setSemanticFallbackTaken] = useState(
		Boolean(entry.semanticUnavailable) &&
			(entry.startMode === "properties" || entry.startAt === "properties"),
	);
	const [nudged, setNudged] = useState(false);
	const [clauseSeq, setClauseSeq] = useState(0);
	const [runState, setRunState] = useState<RunState>(
		entry.runState ?? "backApplyComplete",
	);
	const [step, setStep] = useState<StepId>(
		entry.startAt ?? (fromSearch ? "properties" : "match"),
	);

	const steps = stepsFor({ verb: entry.verb, mode, scope, fromSearch });
	const index = stepIndex(steps, step);
	const current = steps[index];

	const folder = mailboxes.find((mailbox) => mailbox.id === mailboxId);
	const leadSender = dominantSender(envelopesOf(selected));
	const suggestedName = suggestRuleName({
		match:
			mode === "properties" ? clauses[0]?.value.trim() || undefined : undefined,
		sender: leadSender && senderLabel(leadSender),
		folder: folder?.label,
	});
	const ruleName = typedName ?? suggestedName;

	const covered = fromSearch || escalated ? results : selected;
	// A body-text clause cannot be counted before it is saved: the vector-free
	// matcher refuses to evaluate it, so the app never asks. That is a stated
	// answer, not a count of zero, and the sample it leaves empty has to say so.
	const uncountable =
		mode === "properties" &&
		clauses.some((clause) => clause.field === "HasWords");
	// A widened door has no count until it has run; the ticked list is its own
	// count, and the app's would come from the preview endpoint (#477 5.3).
	const count: MatchCount = uncountable
		? { status: "error", reason: UNCOUNTABLE_PREDICATE_REASON }
		: escalated
			? { status: "ready", count: entry.escalatedTotal ?? results.length }
			: mode === "selected"
				? { status: "ready", count: selected.length }
				: { status: "uncounted" };

	const draft: WizardDraft = {
		clauses,
		matchOperator,
		// The similar door rides the semantic widen, which reads message bodies.
		widen: mode === "similar" ? { anchorCount: selected.length } : undefined,
		moveMailboxId: mailboxId,
		scope,
		until,
		name: ruleName,
	};
	// The one account the selection belongs to, as the app hands it over: a
	// selection spanning accounts has none, and the widened doors go with it. One
	// spanning folders of a single account keeps both, and is told about folders.
	const wizardScope = wizardScopeFor(
		entry.restriction === "spansAccounts" ? undefined : "acc-personal",
		entry.restriction,
	);
	const stepRestriction =
		current === "folder"
			? wizardScope.destination
			: current === "rule" && (scope === "standing" || scope === "until")
				? wizardScope.rule
				: undefined;
	const blockedReason =
		stepRestriction ?? stepBlockedReason(current, draft, count);

	const sample = {
		messages:
			uncountable || entry.sampleEmpty || entry.sampleLoading ? [] : covered,
		count,
		label: mode === "selected" ? "Your selection" : "A sample of what matches",
		emptyReason: entry.sampleEmpty,
		loading: entry.sampleLoading,
	};

	// Both endings name what they did not reach; only the badge on each row
	// differs, because only one of them ever sent those messages.
	const failures =
		runState === "backApplyFailed" || runState === "runStopped"
			? covered.slice(0, 2)
			: [];
	const applied =
		runState === "backApplyRunning" ? 0 : covered.length - failures.length;

	const advance = () => {
		if (blockedReason) {
			setNudged(true);
			return;
		}
		setNudged(false);
		setStep(steps[Math.min(steps.length - 1, index + 1)]);
	};

	const fallBackToProperties = () => {
		setSemanticFallbackTaken(true);
		setClauses(withIds(deriveSenderClauses(senders), "sender"));
		setMode("properties");
	};

	const submitClause = () => {
		if (!clauseEdit) return;
		if (clauseEdit.clauseId) {
			setClauses(
				clauses.map((clause) =>
					clause.id === clauseEdit.clauseId
						? { ...clause, ...clauseEdit.draft, derived: undefined }
						: clause,
				),
			);
		} else {
			setClauseSeq(clauseSeq + 1);
			setClauses([
				...clauses,
				{ id: `clause-${clauseSeq + 1}`, ...clauseEdit.draft },
			]);
		}
		setClauseEdit(undefined);
	};

	const createFolder = (
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) =>
		folderCreators[entry.folderCreate ?? "confirms"](
			name,
			parentPath,
			signal,
		).then((created) => {
			setMailboxes((known) =>
				known.some((mailbox) => mailbox.id === created.id)
					? known
					: [...known, created],
			);
			return created;
		});

	return (
		<SelectionWizard
			verb={entry.verb}
			steps={steps}
			step={current}
			onBack={() => {
				setNudged(false);
				setStep(steps[index - 1]);
			}}
			onExit={onExit}
			onContinue={advance}
			onCommit={() => setStep("run")}
			blockedReason={blockedReason}
			nudged={nudged}
			match={{
				selectedCount: selected.length,
				mode,
				accountId: wizardScope.accountId,
				onModeChange: setMode,
				semanticUnavailable: entry.semanticUnavailable || !!entry.semanticError,
				semanticErrorDetail: entry.semanticError,
				semanticFallbackTaken,
				onSemanticFallback: fallBackToProperties,
				escalatedScope: escalated,
				sample,
			}}
			properties={{
				clauses,
				matchOperator,
				onMatchOperatorChange: setMatchOperator,
				clauseEdit,
				onStartAddClause: () =>
					setClauseEdit({ mode: "add", draft: { field: "From", value: "" } }),
				onStartEditClause: (clauseId) => {
					const clause = clauses.find((entry) => entry.id === clauseId);
					if (!clause) return;
					setClauseEdit({
						mode: "edit",
						clauseId,
						draft: { field: clause.field, value: clause.value },
					});
				},
				onRemoveClause: (id) =>
					setClauses(clauses.filter((clause) => clause.id !== id)),
				onChangeDraft: (nextDraft) =>
					setClauseEdit(
						clauseEdit ? { ...clauseEdit, draft: nextDraft } : undefined,
					),
				onSubmitClause: submitClause,
				onCancelClause: () => setClauseEdit(undefined),
				clauseSuggestions: demoClauseSuggestions(
					clauseEdit?.draft.field ?? "From",
					clauseEdit?.draft.value ?? "",
				),
				conversionNotice:
					fromSearch && conversion
						? searchConversionNotice(conversion)
						: undefined,
				semanticFallbackTaken,
				sample: {
					...sample,
					label: "What this matches",
					count: { status: "uncounted" },
				},
			}}
			folder={{
				folders: mailboxes,
				mailboxId,
				onSelect: setMailboxId,
				onCreateFolder: createFolder,
				restriction: wizardScope.destination,
			}}
			rule={{
				draft,
				onScopeChange: setScope,
				onUntilChange: setUntil,
				restriction: wizardScope.rule,
			}}
			name={{ name: ruleName, onNameChange: setTypedName }}
			review={{
				verb: entry.verb,
				mode,
				selectedCount: selected.length,
				clauses,
				matchOperator,
				folder: folder?.label,
				scope,
				until,
				ruleName: steps.includes("name") ? ruleName : undefined,
				escalatedScope: escalated,
				sample,
			}}
			run={{
				state: runState,
				verb: entry.verb,
				scope,
				matched: covered.length,
				applied,
				failures,
				failedCount: entry.failedBeyondNamed ?? failures.length,
				failureReason: entry.runFailureReason,
				onRetry: () =>
					setRunState(
						runState === "commitFailed" ? "saving" : "backApplyRunning",
					),
				onDismiss: onExit,
				// A chunked run stops between batches. A saved rule's pass over
				// existing mail is the mail server's own, so it has no stop.
				onCancelRun:
					runState === "backApplyRunning" &&
					scope !== "standing" &&
					scope !== "until"
						? () => setRunState("runStopped")
						: undefined,
			}}
		/>
	);
}

function SelectionFlow({
	messages = SELECTION_SAMPLE,
	title = "Inbox",
	conversion,
	preselected = 0,
	preselectedIds,
	openAt,
	width = WIDE_PHONE_WIDTH,
}: {
	messages?: SelectionMessage[];
	title?: string;
	/**
	 * What `convertSearchToRule` made of the query this page of results is for.
	 * It puts "Make this a filter" above the list — a second way in, taken or
	 * declined. Ticking rows here reaches the same wizard the inbox reaches.
	 */
	conversion?: SearchConversion;
	/** Tick the first N rows on mount — for stories that open the wizard directly. */
	preselected?: number;
	/** Tick named rows on mount, where which rows they are is the point. */
	preselectedIds?: string[];
	/** Open the wizard on mount, on a given step. */
	openAt?: WizardEntry;
	/**
	 * The tier the wizard is judged at. Match it to the story's viewport: the
	 * shell reflows off its own width, and a modal over one narrow column is not
	 * the room a desktop window has.
	 */
	width?: number;
}) {
	const seeded =
		preselectedIds ?? messages.slice(0, preselected).map((m) => m.id);
	const [ids, setIds] = useState<string[]>(seeded);
	const [entry, setEntry] = useState<WizardEntry | undefined>(openAt);

	const selected = messages.filter((m) => ids.includes(m.id));
	const desktop = width >= 1024;

	return (
		<MailShell
			width={width}
			selectedNavId="mbx_personal_inbox"
			listTitle={title}
			unreadCount={messages.length}
			sections={[{ id: "selection", threads: messages.map(toRow) }]}
			preset={inboxFilterConfig()}
			scopeChip={inboxScope}
			selectedIds={seeded}
			onVerb={(verb, ticked) => {
				setIds([...ticked]);
				setEntry({ verb });
			}}
			{...(conversion
				? {
						onMakeFilter: () =>
							setEntry({ verb: "organize", fromSearch: true }),
						makeFilterBlockedReason: isConvertible(conversion)
							? undefined
							: makeFilterBlockedCopy(
									conversion.droppedFacets.map((facet) => facet.label),
								),
					}
				: {})}
			{...(desktop ? { thread: q3Thread, intelligence: q3Intelligence } : {})}
			overlay={
				entry && (
					<WizardDriver
						entry={entry}
						selected={selected}
						results={messages}
						conversion={conversion}
						onExit={() => setEntry(undefined)}
					/>
				)
			}
		/>
	);
}

/* ------------------------------------------------------------------ */
/* Stories                                                             */
/* ------------------------------------------------------------------ */

/**
 * One responsive surface: below 768px the wizard is full-bleed, from 768px up
 * the same screens render as a centered modal over the list. Flip the toolbar
 * viewport on any story to see both.
 *
 * Every story starts from a real list. The ones that name a step open the
 * wizard there with rows already ticked, so the screen is always judged against
 * the mail behind it.
 *
 * A search is a way in, not a mode: ticking rows in a page of results reaches
 * exactly the wizard the inbox reaches. The one place a query is the anchor is
 * "Make this a filter" above the results, which opens on the property step with
 * the query converted and nothing ticked.
 */
const meta: Meta = {
	title: "Flows/Selection Wizard",
	parameters: { layout: "fullscreen" },
	globals: { viewport: { value: "mobileShort" } },
	decorators: [
		(Story) => (
			<div className="relative h-dvh w-full overflow-hidden bg-surface">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const clickByText = (root: HTMLElement, label: string) => {
	const button = Array.from(
		root.querySelectorAll<HTMLButtonElement>("button"),
	).find((candidate) => candidate.textContent?.trim() === label);
	button?.click();
};

/** Types into the Move picker's search, which is also where a new folder is named. */
const typeFolderName = async (root: HTMLElement, name: string) => {
	const input = root.querySelector<HTMLInputElement>(
		'input[aria-label="Filter folders"]',
	);
	if (!input) return;
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, name);
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await tick();
};

const QUERY = "npm";
const RESULTS_TITLE = `Results for "${QUERY}"`;

/** The three Booking.com rows — one sender across the whole selection. */
const ONE_SENDER = ["m1", "m5", "m8"];

const inboxScope: SearchChip = {
	id: "inbox",
	label: "in:inbox",
	tone: "scope",
};

/**
 * PRIMARY — a plain inbox, nothing ticked. Press and hold a row to tick it, take
 * a verb off the list header, then walk the wizard. With no search behind it the
 * widened options are seeded from the messages you ticked.
 */
export const Inbox: Story = {
	name: "Inbox — no search",
	render: () => <SelectionFlow />,
};

/** The modal over the desktop shell, at the door it opens on. */
export const InboxDesktop: Story = {
	name: "Inbox — no search, desktop",
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<SelectionFlow
			width={DESKTOP_WIDTH}
			preselected={3}
			openAt={{ verb: "organize", startAt: "match" }}
		/>
	),
};

/**
 * PRIMARY — a page of results with "Make this a filter" above it. Take it and
 * the query is the anchor; tick rows instead and the affordance gives way to the
 * selection bar, which opens the inbox's wizard unchanged.
 */
export const SearchResults: Story = {
	name: "Search results — npm",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			conversion={RICH_CONVERSION}
		/>
	),
};

export const SearchResultsDesktop: Story = {
	name: "Search results — npm, desktop",
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<SelectionFlow
			width={DESKTOP_WIDTH}
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			conversion={PLAIN_CONVERSION}
			preselected={4}
			openAt={{ verb: "organize", startAt: "match" }}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* The second way in — converting the search itself                    */
/* ------------------------------------------------------------------ */

/**
 * "Make this a filter" taken. The wizard opens on the property step with the
 * query's clauses, nothing ticked and no anchor step behind it — the query has
 * already said what this applies to, and it carries no widen because free text
 * has no message to read. Everything the filter cannot carry is named above the
 * clauses before anything is edited.
 */
export const SearchConverted: Story = {
	name: "Search — make this a filter",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			conversion={RICH_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true }}
		/>
	),
};

export const SearchConvertedDesktop: Story = {
	name: "Search — make this a filter, desktop",
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<SelectionFlow
			width={DESKTOP_WIDTH}
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			conversion={RICH_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true }}
		/>
	),
};

/** Plain words, nothing scoped or faceted: one clause and nothing to report. */
export const SearchConvertedPlain: Story = {
	name: "Search — make this a filter, plain query",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			conversion={PLAIN_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true }}
		/>
	),
};

/**
 * Searching Starred, where the list header's affordance is borrowed by a bar
 * the view does not own. It is the same entry and the same wizard: every
 * surface that puts the row on screen answers the step it pushes, or the press
 * lands on nothing.
 */
export const SearchConvertedFromStarred: Story = {
	name: "Search — make this a filter, from Starred",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title="Starred"
			conversion={PLAIN_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true }}
		/>
	),
};

/** Nothing in the query converts, so the affordance says so rather than opening. */
export const SearchNotConvertible: Story = {
	name: "Search — nothing to filter on",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			conversion={FACETS_ONLY_CONVERSION}
		/>
	),
};

/**
 * The affordance declined. Rows ticked in a page of results reach the anchor
 * step, the doors and the prefill the inbox reaches — the query is behind the
 * list and nowhere in the wizard.
 */
export const SearchThenSelect: Story = {
	name: "Search — ticked rows, same wizard",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			conversion={RICH_CONVERSION}
			preselected={3}
			openAt={{ verb: "organize", startAt: "match" }}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Walking the flow                                                    */
/* ------------------------------------------------------------------ */

export const DeleteApplyTo: Story = {
	name: "Delete — apply to",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "delete", startAt: "match" }}
		/>
	),
};

export const DeleteProperties: Story = {
	name: "Delete — match properties",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "delete", startAt: "properties" }}
		/>
	),
};

export const DeleteReview: Story = {
	name: "Delete — review",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "delete", startAt: "review" }}
		/>
	),
};

export const DeleteReviewDesktop: Story = {
	name: "Delete — review, desktop",
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<SelectionFlow
			width={DESKTOP_WIDTH}
			preselected={3}
			openAt={{ verb: "delete", startAt: "review" }}
		/>
	),
};

export const DeleteReviewTablet: Story = {
	name: "Delete — review, tablet",
	globals: { viewport: { value: "tablet" } },
	render: () => (
		<SelectionFlow
			width={TABLET_WIDTH}
			preselected={3}
			openAt={{ verb: "delete", startAt: "review" }}
		/>
	),
};

/** Review of a widened match: no count, and a sample that says so. */
export const DeleteReviewSimilar: Story = {
	name: "Delete — review, similar to these",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "delete", startAt: "review", startMode: "similar" }}
		/>
	),
};

export const DeleteDone: Story = {
	name: "Delete — done",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "delete", startAt: "run" }}
		/>
	),
};

export const DeletePartialFailure: Story = {
	name: "Delete — partial failure",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "delete", startAt: "run", runState: "backApplyFailed" }}
		/>
	),
};

export const MoveFolder: Story = {
	name: "Move — folder",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "move", startAt: "folder" }}
		/>
	),
};

/** Typing a name no folder carries offers to make it. */
export const MoveNewFolder: Story = {
	name: "Move — new folder",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "move", startAt: "folder" }}
		/>
	),
	play: async ({ canvasElement }) => {
		await typeFolderName(canvasElement, "Hotels");
	},
};

/**
 * Creating a folder is an IMAP mutation and the move that follows waits on it,
 * so the create holds until the mail server confirms the folder. The wait is on
 * screen and a second press cannot start a second create.
 */
export const MoveNewFolderCreating: Story = {
	name: "Move — new folder, waiting for the server",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "move",
				startAt: "folder",
				folderCreate: "never confirms",
			}}
		/>
	),
	play: async ({ canvasElement }) => {
		await typeFolderName(canvasElement, "Hotels");
		clickByText(canvasElement, 'Create "Hotels"');
	},
};

/** The create failed on the mail server. No folder is picked, and it says so. */
export const MoveNewFolderCreateFailed: Story = {
	name: "Move — new folder, create failed",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "move", startAt: "folder", folderCreate: "fails" }}
		/>
	),
	play: async ({ canvasElement }) => {
		await typeFolderName(canvasElement, "Hotels");
		clickByText(canvasElement, 'Create "Hotels"');
		await tick();
	},
};

export const MoveReview: Story = {
	name: "Move — review",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "move", startAt: "review" }}
		/>
	),
};

export const MarkReadReview: Story = {
	name: "Mark read — review",
	render: () => (
		<SelectionFlow
			preselected={SELECTION_SAMPLE.length}
			openAt={{ verb: "markRead", startAt: "review" }}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Match step — the doors                                              */
/* ------------------------------------------------------------------ */

/** The opening state: the ticked messages, with the two widened doors offered. */
export const OrganizeApplyTo: Story = {
	name: "Organize — apply to",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match" }}
		/>
	),
};

/** The widen-by-reading door taken: the match is anchored on the ticked mail. */
export const OrganizeSimilarDoor: Story = {
	name: "Organize — similar to these",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match", startMode: "similar" }}
		/>
	),
};

/** The property door taken from the anchor step, before the editor opens. */
export const OrganizePropertyDoor: Story = {
	name: "Organize — match on properties",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match", startMode: "properties" }}
		/>
	),
};

/**
 * Similar-mail matching cannot run right now — the embedding backend is down, or
 * this mail is not indexed yet. The door renders dimmed and stays pressable:
 * press it and it says so, then lands on the property door with the senders
 * filled in.
 */
export const OrganizeSemanticUnavailable: Story = {
	name: "Organize — similar unavailable",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match", semanticUnavailable: true }}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Property step — the clauses                                         */
/* ------------------------------------------------------------------ */

/**
 * The sender fallback: no similar-mail matching, senders across three different
 * domains, so one editable `From` clause each.
 */
export const OrganizeSenderFallback: Story = {
	name: "Organize — sender fallback, addresses",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "properties",
				semanticUnavailable: true,
			}}
		/>
	),
};

/**
 * The same fallback where every sender is at one registrable domain. The sender
 * derivation collapses them to a single `FromDomain` clause; the wizard does not
 * ask which, and the clause is an ordinary editable chip either way.
 */
export const OrganizeSenderFallbackDomain: Story = {
	name: "Organize — sender fallback, one domain",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={2}
			openAt={{
				verb: "organize",
				startAt: "properties",
				semanticUnavailable: true,
			}}
		/>
	),
};

/** The sender fallback carried through to a standing rule. */
export const OrganizeSenderFallbackStanding: Story = {
	name: "Organize — sender fallback, standing",
	render: () => (
		<SelectionFlow
			preselected={4}
			openAt={{
				verb: "organize",
				startAt: "name",
				startMode: "properties",
				scope: "standing",
				semanticUnavailable: true,
			}}
		/>
	),
};

/** One sender across the whole selection — a single sharp `From` clause. */
export const OrganizePropertiesSender: Story = {
	name: "Organize — properties, one sender",
	render: () => (
		<SelectionFlow
			preselectedIds={ONE_SENDER}
			openAt={{ verb: "organize", startAt: "properties" }}
		/>
	),
};

/**
 * Senders that share nothing: what the messages have in common is their subject,
 * so the prefill drops to the run of words all three carry.
 */
export const OrganizePropertiesSubject: Story = {
	name: "Organize — properties, shared subject",
	render: () => (
		<SelectionFlow
			messages={SELECTION_RECEIPTS_SAMPLE}
			preselected={3}
			openAt={{ verb: "organize", startAt: "properties" }}
		/>
	),
};

/** The rule matches no mail — said as itself, not as a bare empty list (#452). */
export const OrganizeNothingMatches: Story = {
	name: "Organize — nothing matches",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "properties",
				sampleEmpty: "noMatch",
			}}
		/>
	),
};

/**
 * A body-text clause has no count and never will: the vector-free matcher
 * refuses to read message bodies, so there is nothing to ask and nothing to
 * show. The sample says that, because the alternative — an empty list under
 * "nothing matches this yet" — is not merely unexplained but wrong.
 */
export const OrganizeUncountable: Story = {
	name: "Organize — the count that can't be taken",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "properties",
				startMode: "properties",
				bodyTextClause: true,
			}}
		/>
	),
};

/** Nothing is indexed yet — the other reason for an empty sample (#452). */
export const OrganizeNothingIndexed: Story = {
	name: "Organize — nothing indexed",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "properties",
				sampleEmpty: "notIndexed",
			}}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Scope step                                                          */
/* ------------------------------------------------------------------ */

export const OrganizeScope: Story = {
	name: "Organize — scope",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "rule" }}
		/>
	),
};

/** The standing scope: the rule keeps working on mail that hasn't arrived yet. */
export const OrganizeStanding: Story = {
	name: "Organize — keep doing this",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "rule", scope: "standing" }}
		/>
	),
};

/** The same rule with a stop date, asked for on the step that offers the scope. */
export const OrganizeUntil: Story = {
	name: "Organize — until a date",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "rule", scope: "until" }}
		/>
	),
};

/**
 * A one-time apply cannot read message bodies, so the scope step says so where
 * the choice is made rather than refusing the clause that offered it.
 */
export const OrganizeScopeBodyText: Story = {
	name: "Organize — scope, has the words",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			conversion={PLAIN_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true, startAt: "rule" }}
		/>
	),
};

/** Only reached by a scope that persists — the suggestion is prefilled and editable. */
export const OrganizeName: Story = {
	name: "Organize — name the rule",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "name" }}
		/>
	),
};

export const OrganizeReviewStanding: Story = {
	name: "Organize — review, standing",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "review", scope: "standing" }}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Run step — every commit outcome                                     */
/* ------------------------------------------------------------------ */

export const RunSaving: Story = {
	name: "Run — saving",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "saving",
			}}
		/>
	),
};

/** The pass over the mail already in the mailbox, after the rule is saved. */
export const RunBackApplyInFlight: Story = {
	name: "Run — back-apply in flight",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "backApplyRunning",
			}}
		/>
	),
};

export const RunBackApplyDone: Story = {
	name: "Run — back-apply done",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "backApplyComplete",
			}}
		/>
	),
};

/** The pass failed part-way. The rule itself is saved — that is stated. */
export const RunBackApplyFailed: Story = {
	name: "Run — back-apply failed",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "backApplyFailed",
			}}
		/>
	),
};

/** The pass never began — distinct from failing, and offered again. */
export const RunBackApplyStartFailed: Story = {
	name: "Run — back-apply start failed",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "backApplyStartFailed",
			}}
		/>
	),
};

/**
 * The retry over a pass that already moved mail never reached the server. That
 * pass keeps its counts, and what is offered again is the same retry (#552).
 */
export const RunBackApplyRestartFailed: Story = {
	name: "Run — back-apply restart failed",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "backApplyRestartFailed",
			}}
		/>
	),
};

/**
 * A status poll that could not be read. The pass is still the mail server's, so
 * the counts stay and the way forward is another look, not another run (#526).
 */
export const RunStatusUnknown: Story = {
	name: "Run — status unknown",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "statusUnknown",
			}}
		/>
	),
};

/** The filter saved with nothing to back-apply. */
export const RunFilterSaved: Story = {
	name: "Run — filter saved",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "filterSaved",
			}}
		/>
	),
};

/** The rule was never created — nothing is live, and it can be retried. */
export const RunCommitFailed: Story = {
	name: "Run — commit failed",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "commitFailed",
			}}
		/>
	),
};

/**
 * The commit reached the mail server with nowhere to file into. The screen names
 * the cause and the setting that fixes it, and offers no retry: the same commit
 * resolves the same absent destination every time it is sent (#522).
 */
export const RunNoDestination: Story = {
	name: "Run — nowhere to file into",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "junk",
				startAt: "run",
				scope: "once",
				runState: "commitFailed",
				runFailureReason:
					"This account has no Junk folder appointed, so there is nowhere to file these. Appoint one under Settings › Folders.",
			}}
		/>
	),
};

/** A one-off run ends on its own count, not on a rule. */
export const RunOnceDone: Story = {
	name: "Run — one-off done",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "once",
				runState: "backApplyComplete",
			}}
		/>
	),
};

/**
 * A selection spanning accounts. A folder and a filter both belong to one
 * account, so neither step can be answered — and each says so, in place, rather
 * than offering an empty picker or a scope that cannot be saved (#477 5.5).
 */
export const CrossAccountDestination: Story = {
	name: "Folder — selection spans accounts",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "folder",
				restriction: "spansAccounts",
			}}
		/>
	),
};

/**
 * A selection spanning folders of one account. The account is settled, so the
 * step names the restriction that actually applies — told to pick a single
 * account, a user holding one account's mail has nothing to act on (#525).
 */
export const CrossFolderDestination: Story = {
	name: "Folder — selection spans folders",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "folder",
				restriction: "spansFolders",
			}}
		/>
	),
};

/** One account, one folder: the step asks for a destination and nothing else. */
export const UnrestrictedDestination: Story = {
	name: "Folder — one account, one folder",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{ verb: "organize", startAt: "folder" }}
		/>
	),
};

/**
 * The same selection on the step that asks what the action applies to (#523).
 * Both widened doors are counted by a preview one account answers, so they are
 * withheld rather than left to lead to a review waiting on a count nobody can
 * take. The ticked rows are their own match, and the step says why they are all
 * that is on offer.
 */
export const CrossAccountMatch: Story = {
	name: "Apply to — selection spans accounts",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "match",
				restriction: "spansAccounts",
			}}
		/>
	),
};

/**
 * The folder-spanning selection on the same step. One account answers the
 * preview both widened doors are counted through, so both stay on offer.
 */
export const CrossFolderMatch: Story = {
	name: "Apply to — selection spans folders",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "match",
				restriction: "spansFolders",
			}}
		/>
	),
};

export const CrossAccountRule: Story = {
	name: "Rule — selection spans accounts",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "rule",
				scope: "standing",
				restriction: "spansAccounts",
			}}
		/>
	),
};

export const CrossFolderRule: Story = {
	name: "Rule — selection spans folders",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "rule",
				scope: "standing",
				restriction: "spansFolders",
			}}
		/>
	),
};

/**
 * The widen was asked to run and the mail server refused. The door dims like
 * any other door that cannot run, and carries the server's own words rather
 * than a generic line.
 */
export const MatchWidenFailed: Story = {
	name: "Apply to — the widen failed",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "match",
				semanticError: "The matcher is not reachable right now.",
			}}
		/>
	),
};

/**
 * A widened match reaches mail the list never loaded, so its rows are fetched
 * from the server that matched them. No rows yet is not the same answer as no
 * rows at all — saying "nothing matches" here is the wrong conclusion (#477 3.5).
 */
export const MatchSampleLoading: Story = {
	name: "Apply to — the sample is still arriving",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "match",
				startMode: "similar",
				sampleLoading: true,
			}}
		/>
	),
};

/**
 * A back-apply the server ran itself reports how many it could not apply
 * without handing back the messages behind them, so the count stands alone.
 */
export const RunFailedBeyondNamed: Story = {
	name: "Run — more rejected than can be named",
	render: () => (
		<SelectionFlow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "run",
				scope: "standing",
				runState: "backApplyFailed",
				failedBeyondNamed: 9,
			}}
		/>
	),
};

/* ------------------------------------------------------------------ */
/* Select-all-matching — the selection that is a predicate            */
/* ------------------------------------------------------------------ */

const ESCALATED_SCOPE = `matching "${QUERY}"`;
const ESCALATED_TOTAL = 1284;

const escalatedEntry = (verb: Verb, startAt: StepId): WizardEntry => ({
	verb,
	startAt,
	escalatedScope: ESCALATED_SCOPE,
	escalatedTotal: ESCALATED_TOTAL,
});

/**
 * PRIMARY — the selection the list escalated past its loaded rows. The match
 * step names what the predicate covers instead of offering three ways to widen
 * it: there is nothing to widen, the search is already the match. The sample
 * beneath comes from the server that resolved it, not from the rows on screen.
 */
export const EscalatedApplyTo: Story = {
	name: "Select all matching — apply to",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			preselected={4}
			openAt={escalatedEntry("delete", "match")}
		/>
	),
};

/**
 * The review the predicate now ends on. It states the server's count in the
 * sentence, warns that the run covers whatever matches by the time it goes, and
 * closes with the sample — the screen that replaced the bar's confirmation.
 */
export const EscalatedReview: Story = {
	name: "Select all matching — review",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			preselected={4}
			openAt={escalatedEntry("delete", "review")}
		/>
	),
};

export const EscalatedReviewDesktop: Story = {
	name: "Select all matching — review, desktop",
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<SelectionFlow
			width={DESKTOP_WIDTH}
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			preselected={4}
			openAt={escalatedEntry("delete", "review")}
		/>
	),
};

/** A move over the predicate still asks where, on the step that asks it. */
export const EscalatedMoveFolder: Story = {
	name: "Select all matching — move, folder",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			preselected={4}
			openAt={escalatedEntry("move", "folder")}
		/>
	),
};

/**
 * The chunked runner, driven by the run screen rather than by the bar. Two ways
 * off the screen, and they mean different things: Close leaves a run that keeps
 * going, Stop the run ends it at the next batch.
 */
export const EscalatedRunning: Story = {
	name: "Select all matching — running",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			preselected={4}
			openAt={{
				...escalatedEntry("delete", "run"),
				runState: "backApplyRunning",
			}}
		/>
	),
};

/**
 * The run stopped part-way. The batches it never reached were never sent, so
 * nothing rejected them and nothing has happened to them — which is what the
 * screen says, rather than reporting a mail server that refused them. Retry
 * re-resolves the predicate; every verb it carries is idempotent.
 */
export const EscalatedStopped: Story = {
	name: "Select all matching — stopped part-way",
	render: () => (
		<SelectionFlow
			messages={SELECTION_SEARCH_SAMPLE}
			title={RESULTS_TITLE}
			preselected={4}
			openAt={{
				...escalatedEntry("delete", "run"),
				runState: "runStopped",
			}}
		/>
	),
};
