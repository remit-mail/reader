import {
	Checkbox,
	type ClauseEditState,
	crossAccountDestinationReason,
	crossAccountRuleReason,
	demoClauseSuggestions,
	derivePropertyClauses,
	deriveSenderClauses,
	dominantSender,
	type EnvelopeAddress,
	inboxFilterConfig,
	isConvertible,
	MakeFilterAction,
	type MatchCount,
	type MatchMode,
	type MatchOperator,
	type MoveMailboxOption,
	PopoverMenu,
	type RuleClause,
	type RuleScope,
	type RunState,
	type SampleEmptyReason,
	type SearchChip,
	type SearchConversion,
	SelectionWizard,
	type StepId,
	searchConversionNotice,
	senderLabel,
	stepBlockedReason,
	stepIndex,
	stepsFor,
	suggestRuleName,
	UNCOUNTABLE_PREDICATE_REASON,
	type Verb,
	verbCopy,
	type WizardDraft,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	ArrowLeft,
	Check,
	FolderInput,
	MailOpen,
	ShieldAlert,
	Sparkles,
	Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
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
import {
	allThreads,
	q3Intelligence,
	q3Thread,
	searchSections,
} from "../fixtures/workspace.js";
import { MailShell } from "../screens/mail-shell.js";

/* ------------------------------------------------------------------ */
/* The list and its action bar — where the wizard is opened from       */
/* ------------------------------------------------------------------ */

const VERB_ICON: Record<Verb, ReactNode> = {
	delete: <Trash2 className="size-5" />,
	move: <FolderInput className="size-5" />,
	junk: <ShieldAlert className="size-5" />,
	markRead: <MailOpen className="size-5" />,
	organize: <Sparkles className="size-5" />,
};

const BAR_VERBS: Verb[] = ["delete", "move", "organize"];
const OVERFLOW_VERBS: Verb[] = ["junk", "markRead"];

function SelectAllToggle({
	allSelected,
	indeterminate,
	onToggle,
	className,
}: {
	allSelected: boolean;
	indeterminate: boolean;
	onToggle: () => void;
	className: string;
}) {
	return (
		<Checkbox
			className={className}
			checked={allSelected}
			indeterminate={indeterminate}
			onChange={onToggle}
			label={
				<span className="font-medium text-accent">
					{allSelected ? "Deselect all" : "Select all"}
				</span>
			}
		/>
	);
}

function ListActionBar({
	title,
	count,
	allSelected,
	onToggleAll,
	onExit,
	onVerb,
}: {
	title: string;
	count: number;
	allSelected: boolean;
	onToggleAll: () => void;
	onExit: () => void;
	onVerb: (verb: Verb) => void;
}) {
	const selecting = count > 0;

	return (
		<div className="shrink-0 border-b border-line bg-surface">
			<div className="flex h-14 items-center gap-1 px-2">
				{selecting && (
					<button
						type="button"
						onClick={onExit}
						aria-label="Exit selection"
						className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted md:hidden"
					>
						<ArrowLeft className="size-5" />
					</button>
				)}

				<SelectAllToggle
					allSelected={allSelected}
					indeterminate={selecting && !allSelected}
					onToggle={onToggleAll}
					className="hidden shrink-0 pl-1 pr-2 md:flex"
				/>

				<span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
					{selecting ? (
						<>
							<span className="tabular-nums">{count}</span>
							<span className="font-normal text-fg-muted"> selected</span>
						</>
					) : (
						title
					)}
				</span>

				{selecting && (
					<>
						{BAR_VERBS.map((verb) => (
							<button
								key={verb}
								type="button"
								onClick={() => onVerb(verb)}
								aria-label={verbCopy(verb).label}
								title={verbCopy(verb).label}
								className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-sunken"
							>
								{VERB_ICON[verb]}
							</button>
						))}
						<PopoverMenu
							triggerLabel="More actions"
							items={OVERFLOW_VERBS.map((verb) => ({
								key: verb,
								label: verbCopy(verb).label,
								icon: VERB_ICON[verb],
								onSelect: () => onVerb(verb),
							}))}
						/>
					</>
				)}
			</div>

			{selecting && (
				<SelectAllToggle
					allSelected={allSelected}
					indeterminate={!allSelected}
					onToggle={onToggleAll}
					className="w-full px-3 pb-2 md:hidden"
				/>
			)}
		</div>
	);
}

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
	/** The selection spans accounts, so no folder and no rule can be reached. */
	crossAccount?: boolean;
	runState?: RunState;
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

const MAILBOXES: MoveMailboxOption[] = SELECTION_FOLDERS.map((path) => ({
	id: `mbx-${path.toLowerCase().replace(/\//g, "-")}`,
	label: path,
	searchValue: path,
}));

/** A create that resolves only once the mail server has confirmed the folder. */
const folderCreators: Record<
	NonNullable<WizardEntry["folderCreate"]>,
	(name: string, signal?: AbortSignal) => Promise<MoveMailboxOption>
> = {
	confirms: (name) =>
		Promise.resolve({ id: `mbx-${name.toLowerCase()}`, label: name }),
	"never confirms": (_name, signal) =>
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
	const [mailboxes, setMailboxes] = useState<MoveMailboxOption[]>(MAILBOXES);
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
	const blockedReason = stepBlockedReason(current, draft, count);

	const sample = {
		messages:
			uncountable || entry.sampleEmpty || entry.sampleLoading ? [] : covered,
		count,
		label: mode === "selected" ? "Your selection" : "A sample of what matches",
		emptyReason: entry.sampleEmpty,
		loading: entry.sampleLoading,
	};

	const restriction = entry.crossAccount ? crossAccountRuleReason : undefined;
	const destinationRestriction = entry.crossAccount
		? crossAccountDestinationReason
		: undefined;

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

	const createFolder = (name: string, signal?: AbortSignal) =>
		folderCreators[entry.folderCreate ?? "confirms"](name, signal).then(
			(created) => {
				setMailboxes((known) =>
					known.some((mailbox) => mailbox.id === created.id)
						? known
						: [...known, created],
				);
				return created;
			},
		);

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
				mailboxes,
				mailboxId,
				onSelect: setMailboxId,
				onCreateFolder: createFolder,
				restriction: destinationRestriction,
			}}
			rule={{
				draft,
				onScopeChange: setScope,
				onUntilChange: setUntil,
				restriction,
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
				onRetry: () =>
					setRunState(
						runState === "commitFailed" ? "saving" : "backApplyRunning",
					),
				onDismiss: onExit,
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
	backdrop,
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
	 * The screen the wizard is judged against. The single-column list is the
	 * phone's; a desktop story hands the whole mail shell instead, because a modal
	 * over one narrow column is not the room a desktop window has.
	 */
	backdrop?: ReactNode;
}) {
	const [ids, setIds] = useState<string[]>(
		() => preselectedIds ?? messages.slice(0, preselected).map((m) => m.id),
	);
	const [entry, setEntry] = useState<WizardEntry | undefined>(openAt);

	const selected = messages.filter((m) => ids.includes(m.id));
	const toggle = (id: string) =>
		setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

	const wizard = entry && (
		<WizardDriver
			entry={entry}
			selected={selected}
			results={messages}
			conversion={conversion}
			onExit={() => setEntry(undefined)}
		/>
	);

	if (backdrop) {
		return (
			<div className="relative h-full w-full overflow-hidden font-sans">
				{backdrop}
				{wizard}
			</div>
		);
	}

	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-surface font-sans">
			<ListActionBar
				title={title}
				count={ids.length}
				allSelected={ids.length === messages.length}
				onToggleAll={() =>
					setIds(
						ids.length === messages.length ? [] : messages.map((m) => m.id),
					)
				}
				onExit={() => setIds([])}
				onVerb={(verb) => setEntry({ verb })}
			/>
			{conversion && ids.length === 0 && (
				<MakeFilterAction
					onClick={() => setEntry({ verb: "organize", fromSearch: true })}
					blockedReason={
						isConvertible(conversion)
							? undefined
							: "Add a sender or words to filter on"
					}
				/>
			)}
			<ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
				{messages.map((m) => {
					const on = ids.includes(m.id);
					return (
						<li key={m.id}>
							<button
								type="button"
								onClick={() => toggle(m.id)}
								className={[
									"flex w-full items-start gap-3 px-3 py-2.5 text-left",
									on ? "bg-accent-soft" : "",
								].join(" ")}
							>
								<span
									className={[
										"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
										on
											? "border-accent bg-accent text-accent-fg"
											: "border-line",
									].join(" ")}
								>
									{on && <Check className="size-3" />}
								</span>
								<span className="min-w-0 flex-1">
									<span className="flex items-baseline justify-between gap-2">
										<span className="truncate text-sm font-medium">
											{m.sender}
										</span>
										<span className="shrink-0 text-2xs text-fg-subtle">
											{m.date}
										</span>
									</span>
									<span className="block truncate text-sm">{m.subject}</span>
									<span className="block truncate text-xs text-fg-muted">
										{m.preview}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ul>

			{wizard}
		</div>
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
 * The desktop screen the modal is judged against — nav column, list, reading
 * pane and intelligence rail, the shell the `/mail` route mounts. A modal over a
 * single narrow column says nothing about the room a desktop window has.
 */
const DesktopBackdrop = () => (
	<MailShell
		selectedNavId="mbx_personal_inbox"
		listTitle="Inbox"
		unreadCount={9}
		sections={[{ id: "inbox", threads: allThreads }]}
		preset={inboxFilterConfig()}
		scopeChip={inboxScope}
		thread={q3Thread}
		selectedThreadId="thr_q3"
		intelligence={q3Intelligence}
	/>
);

/** The same shell with a query up, so the results are what sits behind the modal. */
const DesktopSearchBackdrop = () => (
	<MailShell
		selectedNavId="mbx_personal_inbox"
		listTitle="Inbox"
		unreadCount={9}
		sections={[{ id: "inbox", threads: allThreads }]}
		preset={inboxFilterConfig()}
		scopeChip={inboxScope}
		query={QUERY}
		searchSections={searchSections}
		thread={q3Thread}
		selectedThreadId="thr_q3"
		intelligence={q3Intelligence}
	/>
);

/**
 * PRIMARY — a plain inbox, nothing ticked. Tick a row, press a verb on the bar,
 * then walk the wizard. With no search behind it the widened options are seeded
 * from the messages you ticked.
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
			backdrop={<DesktopBackdrop />}
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
			backdrop={<DesktopSearchBackdrop />}
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
			backdrop={<DesktopSearchBackdrop />}
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
			backdrop={<DesktopBackdrop />}
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
			openAt={{ verb: "organize", startAt: "folder", crossAccount: true }}
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
				crossAccount: true,
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
			backdrop={<DesktopSearchBackdrop />}
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

/** The chunked runner, driven by the run screen rather than by the bar. */
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
