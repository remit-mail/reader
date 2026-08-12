/**
 * The selection wizard's shell and its seven step bodies (#477).
 *
 * One responsive surface: full-bleed below 768px, the same screens as a centred
 * modal from 768px up. Every screen is a fixed header, one scrolling body and a
 * fixed footer in the thumb zone, so back and forward are always reachable.
 *
 * Everything here is props-in. The step is held by id, the answers and the
 * callbacks belong to whoever drives it, and nothing touches history.
 */

import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Check,
	Loader2,
	X,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../lib/cn.js";
import {
	backExits,
	crossAccountMatchReason,
	ESCALATED_MATCH_HINT,
	ESCALATED_REVIEW_WARNING,
	ESCALATED_SCOPE_FALLBACK,
	escalatedMatchLabel,
	type MatchCount,
	type MatchDoor,
	type MatchMode,
	matchDoorHint,
	matchDoorLabel,
	matchDoorsFor,
	matchPhrase,
	matchSummary,
	type RunCopy,
	type RunOutcome,
	type RunState,
	runCopy,
	type SampleEmptyReason,
	type StepId,
	sampleEmptyCopy,
	stepIndex,
	stepLabel,
	unreadableDraftClauses,
	type Verb,
	verbCopy,
	type WizardDraft,
} from "../lib/wizard-steps.js";
import { Badge } from "./badge.js";
import { BlockedReason } from "./blocked-reason.js";
import { Button } from "./button.js";
import { FieldLabel } from "./field-label.js";
import {
	AddChipButton,
	ClauseChip,
	type ClauseDraft,
	ClauseEditor,
} from "./filter-clause-chip.js";
import {
	type ClauseField,
	commitLabel,
	type MatchOperator,
	matchJoinWord,
	matchOperatorLabel,
	previewCountSummary,
	type RuleClause,
	type RuleScope,
	ruleBlockedCopy,
	scopeLabel,
} from "./filter-rule.js";
import type { ClauseEditState } from "./filter-rule-editor.js";
import { FlowScreen, FlowStepRail } from "./flow-screen.js";
import { type FolderTreeNode, FolderTreePicker } from "./folder-tree-picker.js";
import { Input } from "./input.js";
import { ProgressBar } from "./progress-bar.js";
import type { SearchConversionNotice } from "./search-conversion.js";
import { SearchConversionNoticeView } from "./search-conversion-notice.js";
import { SegmentedControl, type SegmentedOption } from "./segmented-control.js";
import type { Suggestion } from "./suggest-list.js";

/** A row of the match, as the sample and the failure list render it. */
export interface WizardMessage {
	id: string;
	sender: string;
	subject: string;
	date: string;
}

export interface StepRailProps {
	steps: readonly StepId[];
	step: StepId;
}

export function StepRail({ steps, step }: StepRailProps) {
	return (
		<FlowStepRail count={steps.length} activeStep={stepIndex(steps, step)} />
	);
}

export interface WizardScreenProps {
	title: string;
	subtitle?: string;
	steps: readonly StepId[];
	step: StepId;
	onBack: () => void;
	onExit: () => void;
	footer: ReactNode;
	children: ReactNode;
}

/**
 * The wizard chrome. The body is the only scrolling region, so the header's back
 * and the footer's controls never leave the screen. From 768px up the same
 * markup centres over the list as a modal rather than becoming a second screen.
 */
export function WizardScreen({
	title,
	subtitle,
	steps,
	step,
	onBack,
	onExit,
	footer,
	children,
}: WizardScreenProps) {
	// A modal at every width: full-bleed below 768px it covers the list rather
	// than sitting beside it, so the list behind must leave the accessibility
	// tree with it — otherwise the verbs that opened the wizard are still
	// reachable underneath the screen that replaced them.
	return (
		<FlowScreen
			title={title}
			subtitle={subtitle}
			steps={steps.map(stepLabel)}
			activeStep={stepIndex(steps, step)}
			onBack={onBack}
			onExit={onExit}
			footer={footer}
		>
			{children}
		</FlowScreen>
	);
}

export interface ChoiceCardProps {
	selected: boolean;
	title: ReactNode;
	description: ReactNode;
	/** Stays pressable and dimmed; pressing it must take the user somewhere that works. */
	unavailable?: boolean;
	onSelect: () => void;
	children?: ReactNode;
}

/**
 * Nothing disables (#477 1.7). An unavailable choice is dimmed and stays
 * pressable, because pressing it is what takes the user somewhere that works —
 * `aria-disabled` would announce it as a control that does nothing and take that
 * away. What makes it unavailable is announced with it instead.
 */
export function ChoiceCard({
	selected,
	title,
	description,
	unavailable,
	onSelect,
	children,
}: ChoiceCardProps) {
	const hintId = useId();
	return (
		<div className="space-y-1.5">
			<button
				type="button"
				onClick={onSelect}
				aria-pressed={selected}
				aria-describedby={unavailable && children ? hintId : undefined}
				className={cn(
					"flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
					selected
						? "border-accent bg-accent-soft"
						: "border-line bg-surface hover:bg-surface-sunken",
					unavailable && "opacity-55",
				)}
			>
				<span
					className={cn(
						"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
						selected ? "border-accent bg-accent text-accent-fg" : "border-line",
					)}
				>
					{selected && <Check className="size-3" />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium text-fg">{title}</span>
					<span className="mt-0.5 block text-xs text-fg-muted">
						{description}
					</span>
				</span>
			</button>
			{children && <div id={hintId}>{children}</div>}
		</div>
	);
}

export interface SelectionSampleProps {
	messages: readonly WizardMessage[];
	/**
	 * The server's count of what the match covers (#477 5.3), carrying whether it
	 * is still moving so nothing commits against a number that is about to change.
	 * `uncounted` is the widened door, which carries no count until it has run.
	 */
	count: MatchCount;
	label: string;
	/** Why there are no rows. Defaults to nothing matching, never to a bare empty state. */
	emptyReason?: SampleEmptyReason;
	/**
	 * The rows are still being fetched. No rows yet is not the same answer as no
	 * rows at all, and "nothing matches" beside a server count that says otherwise
	 * is the wrong conclusion (#477 3.5).
	 */
	loading?: boolean;
}

const sampleFooter = (count: MatchCount, shown: number): string => {
	if (count.status === "uncounted") {
		return "The first matches. The total is not known until the run finishes.";
	}
	if (count.status === "ready" && count.count > shown && !count.stale) {
		return `and ${count.count - shown} more`;
	}
	return previewCountSummary(count);
};

/**
 * What an empty sample says. A count that could not be taken says so; only a
 * count that came back empty may say nothing matches (#477 3.5).
 *
 * A body-text clause is the case that makes the difference load-bearing: the
 * vector-free matcher refuses to evaluate it, so there is no count and no rows,
 * and "nothing matches this yet" is not merely unexplained but wrong — the rule
 * matches, once a saved rule is what runs it.
 */
const sampleEmptyLine = (
	count: MatchCount,
	emptyReason: SampleEmptyReason | undefined,
	loading: boolean | undefined,
): string => {
	if (loading) return "Fetching the messages this covers…";
	if (count.status === "error") return count.reason;
	return sampleEmptyCopy(emptyReason ?? "noMatch");
};

/**
 * The members of the match, closing every screen that names one. A named match
 * with no members shown is an unseen bulk action, so the rows scroll in their own
 * bounded region rather than truncating.
 */
export function SelectionSample({
	messages,
	count,
	label,
	emptyReason,
	loading,
}: SelectionSampleProps) {
	return (
		<section className="flex flex-col rounded-lg border border-line bg-surface">
			<h2 className="shrink-0 border-b border-line px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
				{label}
			</h2>
			{messages.length === 0 ? (
				<p className="px-3 py-4 text-xs text-fg-muted">
					{sampleEmptyLine(count, emptyReason, loading)}
				</p>
			) : (
				<>
					<ul className="min-h-0 max-h-[45dvh] divide-y divide-line overflow-y-auto overscroll-contain md:max-h-[17rem]">
						{messages.map((message) => (
							<li key={message.id} className="px-3 py-2">
								<div className="flex items-baseline justify-between gap-2">
									<span className="truncate text-xs font-medium text-fg">
										{message.sender}
									</span>
									<span className="shrink-0 text-2xs text-fg-subtle">
										{message.date}
									</span>
								</div>
								<p className="truncate text-xs text-fg-muted">
									{message.subject}
								</p>
							</li>
						))}
					</ul>
					<p className="shrink-0 border-t border-line px-3 py-2 text-2xs text-fg-subtle">
						{sampleFooter(count, messages.length)}
					</p>
				</>
			)}
		</section>
	);
}

export interface FooterNavProps {
	onBack: () => void;
	nextLabel: string;
	onNext: () => void;
	/** `commit` reads as primary without the arrow: it ends the flow. */
	nextVariant?: "primary" | "commit" | "danger";
	/** What the step is still missing. Dims the control; never disables it. */
	blockedReason?: string;
	/** Continue was pressed while blocked, so the reason is on screen. */
	nudged?: boolean;
}

/**
 * Nothing disables (#477 1.7). A Continue with an answer still missing is dimmed
 * and stays pressable — and stays pressable to assistive technology too, which
 * `aria-disabled` would have taken away along with the reason. `BlockedReason`
 * carries the two ways that reason reaches the user.
 */
export function FooterNav({
	onBack,
	nextLabel,
	onNext,
	nextVariant = "primary",
	blockedReason,
	nudged,
}: FooterNavProps) {
	const reasonId = useId();
	return (
		<div className="space-y-2">
			{blockedReason && (
				<BlockedReason
					id={reasonId}
					reason={blockedReason}
					nudged={nudged}
					className="px-1 text-2xs text-warning"
				/>
			)}
			<div className="flex items-center gap-3">
				<Button
					variant="ghost"
					size="touch"
					onClick={onBack}
					icon={<ArrowLeft className="size-4" />}
					className="shrink-0"
				>
					Back
				</Button>
				<Button
					variant={nextVariant === "danger" ? "danger" : "primary"}
					size="touch"
					onClick={onNext}
					aria-describedby={blockedReason ? reasonId : undefined}
					className={cn("flex-1", blockedReason && "opacity-55")}
				>
					{nextLabel}
					{nextVariant === "primary" && <ArrowRight className="size-4" />}
				</Button>
			</div>
		</div>
	);
}

export interface MatchStepProps {
	selectedCount: number;
	mode: MatchMode;
	/**
	 * The one account this selection belongs to, absent when it spans several
	 * (#523). Both widened doors are counted through a preview that account
	 * answers, so without one they are withheld and the step states the
	 * restriction — the ticked rows are their own match and stay on offer.
	 */
	accountId?: string;
	/**
	 * Answers the door. Typed to the three doors rather than to every mode, so
	 * no driver can set `escalated` from a screen — the list escalates a
	 * selection, the wizard never does.
	 */
	onModeChange: (mode: MatchDoor) => void;
	/**
	 * Similar-mail matching cannot run right now. A runtime state, not a property
	 * of the deployment: the door stays pressable and dimmed.
	 */
	semanticUnavailable?: boolean;
	/**
	 * What the mail server said when the widen was asked to run and failed. A
	 * failure is a reason the door cannot run, so it dims the door like any other
	 * — with the server's own words under it rather than a generic line.
	 */
	semanticErrorDetail?: string;
	/** The dimmed door was pressed and the senders were filled in instead. */
	semanticFallbackTaken?: boolean;
	onSemanticFallback: () => void;
	/**
	 * What the escalated predicate covers, in the words the list escalated it
	 * with. Read only while the mode is `escalated`, where it replaces the three
	 * doors: the predicate is the match already.
	 */
	escalatedScope?: string;
	sample: SelectionSampleProps;
}

export function MatchStepBody({
	selectedCount,
	mode,
	accountId,
	onModeChange,
	semanticUnavailable,
	semanticErrorDetail,
	semanticFallbackTaken,
	onSemanticFallback,
	escalatedScope,
	sample,
}: MatchStepProps) {
	if (mode === "escalated") {
		return (
			<>
				<div className="rounded-lg border border-accent bg-accent-soft p-3">
					<p className="text-sm font-medium text-fg">
						{escalatedMatchLabel(escalatedScope ?? ESCALATED_SCOPE_FALLBACK)}
					</p>
					<p className="mt-1 text-xs text-fg-muted">{ESCALATED_MATCH_HINT}</p>
				</div>
				<div className="mt-4">
					<SelectionSample {...sample} />
				</div>
			</>
		);
	}
	const doors = matchDoorsFor(accountId);
	const widened = doors.length > 1;
	return (
		<>
			<div className="space-y-2">
				{!widened && (
					<p className="px-1 text-2xs text-warning">
						{crossAccountMatchReason}
					</p>
				)}
				<ChoiceCard
					selected={mode === "selected"}
					onSelect={() => onModeChange("selected")}
					title={matchDoorLabel("selected", selectedCount)}
					description={matchDoorHint("selected")}
				/>
				{widened && (
					<ChoiceCard
						selected={mode === "similar"}
						unavailable={semanticUnavailable}
						onSelect={
							semanticUnavailable
								? onSemanticFallback
								: () => onModeChange("similar")
						}
						title={matchDoorLabel("similar", selectedCount)}
						description={matchDoorHint("similar")}
					>
						{semanticErrorDetail && (
							<p role="status" className="px-1 text-2xs text-danger">
								Couldn't find similar messages: {semanticErrorDetail}
							</p>
						)}
						{semanticFallbackTaken && (
							<p role="status" className="px-1 text-2xs text-fg-subtle">
								Similar-mail matching is unavailable right now — matching on the
								senders instead.
							</p>
						)}
					</ChoiceCard>
				)}
				{widened && (
					<ChoiceCard
						selected={mode === "properties"}
						onSelect={() => onModeChange("properties")}
						title={matchDoorLabel("properties", selectedCount)}
						description={matchDoorHint("properties")}
					/>
				)}
			</div>
			<div className="mt-4">
				<SelectionSample {...sample} />
			</div>
		</>
	);
}

const MATCH_OPERATOR_OPTIONS: SegmentedOption<MatchOperator>[] = [
	{ value: "all", label: matchOperatorLabel("all") },
	{ value: "any", label: matchOperatorLabel("any") },
];

export interface PropertiesStepProps {
	clauses: readonly RuleClause[];
	matchOperator: MatchOperator;
	onMatchOperatorChange: (operator: MatchOperator) => void;
	/** The clause being added or amended, or absent when none is. */
	clauseEdit?: ClauseEditState;
	onStartAddClause: () => void;
	onStartEditClause: (clauseId: string) => void;
	onRemoveClause: (clauseId: string) => void;
	onChangeDraft: (draft: ClauseDraft) => void;
	onSubmitClause: () => void;
	onCancelClause: () => void;
	/** The fields this deployment can actually match on. Defaults to the whole vocabulary. */
	clauseFields?: ClauseField[];
	/** Values worth offering for the field being edited — never a constraint. */
	clauseSuggestions?: readonly Suggestion[];
	/** What converting a search left behind, when a query is what opened this. */
	conversionNotice?: SearchConversionNotice;
	/** The similar door was dimmed and these are the senders it fell back to. */
	semanticFallbackTaken?: boolean;
	sample: SelectionSampleProps;
}

/**
 * The clauses as the rule editor renders them — the same chips, the same inline
 * editor and the same value suggestions — so a rule reads identically whether it
 * was built here or in Settings.
 */
export function PropertiesStepBody({
	clauses,
	matchOperator,
	onMatchOperatorChange,
	clauseEdit,
	onStartAddClause,
	onStartEditClause,
	onRemoveClause,
	onChangeDraft,
	onSubmitClause,
	onCancelClause,
	clauseFields,
	clauseSuggestions,
	conversionNotice,
	semanticFallbackTaken,
	sample,
}: PropertiesStepProps) {
	const join = matchJoinWord(matchOperator);
	return (
		<div className="space-y-4">
			{semanticFallbackTaken && (
				<p role="status" className="px-1 text-xs text-fg-muted">
					Similar-mail matching is unavailable right now. These are the senders
					of the messages you picked.
				</p>
			)}

			{conversionNotice && (
				<SearchConversionNoticeView notice={conversionNotice} />
			)}

			<div className="flex flex-wrap items-center gap-1.5">
				{clauses.map((clause, index) => (
					<Fragment key={clause.id}>
						{index > 0 && (
							<span className="text-2xs font-medium uppercase text-fg-subtle">
								{join}
							</span>
						)}
						<ClauseChip
							clause={clause}
							onEdit={() => onStartEditClause(clause.id)}
							onRemove={() => onRemoveClause(clause.id)}
						/>
					</Fragment>
				))}
				{!clauseEdit && (
					<AddChipButton label="Add clause" onClick={onStartAddClause} />
				)}
			</div>

			{clauseEdit && (
				<ClauseEditor
					draft={clauseEdit.draft}
					mode={clauseEdit.mode}
					fields={clauseFields}
					suggestions={clauseSuggestions}
					onChangeField={(field) =>
						onChangeDraft({ ...clauseEdit.draft, field })
					}
					onChangeValue={(value) =>
						onChangeDraft({ ...clauseEdit.draft, value })
					}
					onSubmit={onSubmitClause}
					onCancel={onCancelClause}
				/>
			)}

			{clauses.length > 1 && (
				<div className="flex items-center gap-2">
					<span className="text-xs text-fg-muted">Match</span>
					<SegmentedControl
						name="wizard-match-operator"
						size="sm"
						aria-label="Match operator"
						options={MATCH_OPERATOR_OPTIONS}
						value={matchOperator}
						onChange={onMatchOperatorChange}
					/>
				</div>
			)}

			<p className="px-1 text-xs text-fg-muted">
				We started you off from what you were looking at. Change any of it —
				this is where the rule is decided, not the list behind it.
			</p>

			<SelectionSample {...sample} />
		</div>
	);
}

export interface FolderStepProps {
	/**
	 * The destinations, already filtered, ordered and labelled by the app
	 * (`buildMoveTargets`). The wizard does not reorder them: a second ordering
	 * beside the one the Move picker already applies would fight it.
	 */
	folders: readonly FolderTreeNode[];
	/** The destination chosen so far. */
	mailboxId?: string;
	onSelect: (mailboxId: string) => void;
	/**
	 * Creating a folder is an IMAP mutation and the move that follows is a
	 * dependent write, so this resolves only once the mail server confirms the
	 * folder (docs/architecture/imap-mutations.md). The picker holds the wait,
	 * refuses a second submit while it runs, and states a failure where it
	 * happened. Absent offers no create.
	 */
	onCreateFolder?: (
		name: string,
		parentPath: string,
		signal?: AbortSignal,
	) => Promise<FolderTreeNode>;
	/** The account's hierarchy separator, which the tree nests on. */
	delimiter?: string;
	/**
	 * Why no destination can be chosen — the selection spans more accounts, or
	 * more folders, than a move can take (#477 5.5, #525). In the words of the
	 * scope it actually spans, so the instruction is one the user can follow. Said
	 * here rather than left as an empty picker.
	 */
	restriction?: string;
}

export function FolderStepBody({
	folders,
	mailboxId,
	onSelect,
	onCreateFolder,
	delimiter,
	restriction,
}: FolderStepProps) {
	const chosen = folders.find((folder) => folder.id === mailboxId);
	return (
		<div className="flex min-h-0 flex-col gap-3">
			<p
				className={cn(
					"px-1 text-xs",
					restriction ? "text-warning" : "text-fg-muted",
				)}
			>
				{restriction ??
					(chosen
						? `Moving to ${chosen.label}.`
						: "Tap a folder to open it, or make a new one where you want it.")}
			</p>
			<div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface">
				<FolderTreePicker
					folders={folders}
					selectedId={mailboxId}
					onSelect={onSelect}
					onCreateFolder={onCreateFolder}
					delimiter={delimiter}
					labels={{
						createPending: "Waiting for the mail server to confirm the folder…",
					}}
				/>
			</div>
		</div>
	);
}

export interface RuleStepProps {
	/**
	 * The rule so far. The scope and its stop date are answered here; the rest is
	 * read, because whether a one-time apply can serve this rule depends on what
	 * is matching it — a body-text clause is unreadable under the literal matcher
	 * and perfectly readable under the semantic widen.
	 */
	draft: WizardDraft;
	onScopeChange: (scope: RuleScope) => void;
	onUntilChange: (until: string) => void;
	/**
	 * Why the two persisting scopes cannot be reached from here — the selection
	 * spans more accounts, or more folders, than a rule can take (#477 5.5, #525),
	 * in the words of the scope it actually spans. They stay pressable and say
	 * this; the one-off scope is unaffected.
	 */
	restriction?: string;
}

export function RuleStepBody({
	draft,
	onScopeChange,
	onUntilChange,
	restriction,
}: RuleStepProps) {
	const untilId = useId();
	const { scope, until = "" } = draft;
	const unreadable = unreadableDraftClauses(draft).length > 0;
	const restricted = restriction && (
		<p className="px-1 text-2xs text-warning">{restriction}</p>
	);

	return (
		<div className="space-y-2">
			<ChoiceCard
				selected={scope === "once"}
				onSelect={() => onScopeChange("once")}
				title={scopeLabel("once")}
				description="A one-off tidy-up. Nothing changes for future mail."
			>
				{unreadable && (
					<p className="px-1 text-2xs text-warning">
						{ruleBlockedCopy.bodyTextOnce}
					</p>
				)}
			</ChoiceCard>
			<ChoiceCard
				selected={scope === "standing"}
				unavailable={Boolean(restriction)}
				onSelect={() => onScopeChange("standing")}
				title={scopeLabel("standing")}
				description="Saves a rule and applies it to new mail as it arrives, and to the mail already in your mailbox. You'll name it next."
			>
				{restricted}
			</ChoiceCard>
			<ChoiceCard
				selected={scope === "until"}
				unavailable={Boolean(restriction)}
				onSelect={() => onScopeChange("until")}
				title={scopeLabel("until")}
				description="The same rule, and it stops on a day you pick."
			>
				{restricted}
				{scope === "until" && (
					<div className="rounded-lg border border-line bg-surface p-2">
						<FieldLabel htmlFor={untilId}>Stops on</FieldLabel>
						<Input
							id={untilId}
							type="date"
							value={until}
							onChange={(event) => onUntilChange(event.target.value)}
						/>
					</div>
				)}
			</ChoiceCard>
		</div>
	);
}

export interface NameStepProps {
	name: string;
	onNameChange: (name: string) => void;
	/**
	 * Continue was pressed while the name was still missing. The field takes
	 * focus, so the answer the message asks for is one keystroke away rather than
	 * one more tap.
	 */
	nudged?: boolean;
}

export function NameStepBody({ name, onNameChange, nudged }: NameStepProps) {
	const nameId = useId();
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (nudged) inputRef.current?.focus();
	}, [nudged]);

	return (
		<>
			<FieldLabel htmlFor={nameId}>Rule name</FieldLabel>
			<Input
				id={nameId}
				ref={inputRef}
				value={name}
				placeholder="Travel confirmations"
				onChange={(event) => onNameChange(event.target.value)}
				trailing={
					name ? (
						<button
							type="button"
							aria-label="Clear name"
							onClick={() => {
								onNameChange("");
								inputRef.current?.focus();
							}}
							className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-surface hover:text-fg"
						>
							<X className="size-4" />
						</button>
					) : undefined
				}
			/>
			<p className="mt-2 text-xs text-fg-muted">
				We suggested one from this selection. Clear it and write your own if it
				doesn't read right.
			</p>
		</>
	);
}

export interface ReviewStepProps {
	verb: Verb;
	mode: MatchMode;
	selectedCount: number;
	clauses: readonly RuleClause[];
	matchOperator: MatchOperator;
	folder?: string;
	scope?: RuleScope;
	until?: string;
	/** Present when the flow reached the naming step. */
	ruleName?: string;
	/** What the escalated predicate covers, in the list's own words. */
	escalatedScope?: string;
	sample: SelectionSampleProps;
}

export function ReviewStepBody({
	verb,
	mode,
	selectedCount,
	clauses,
	matchOperator,
	folder,
	scope,
	until,
	ruleName,
	escalatedScope,
	sample,
}: ReviewStepProps) {
	const { label } = verbCopy(verb);
	const description = {
		mode,
		selectedCount,
		clauses,
		matchOperator,
		escalatedScope,
		// A count still moving is not a number to commit against, and the footer
		// under the review's Continue already says so.
		escalatedCount:
			sample.count.status === "ready" ? sample.count.count : undefined,
	};
	const widened = mode !== "selected";
	const persists = scope === "standing" || scope === "until";

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-line bg-surface p-3">
				<p className="text-sm text-fg">
					<span className="font-semibold">{label}</span>{" "}
					{matchPhrase(description)}
					{folder ? ` to ${folder}` : ""}
					{persists && (
						<>
							{" "}
							and <span className="font-medium">save a rule</span> that keeps
							doing it
						</>
					)}
					{scope === "until" && until && ` until ${until}`}.
				</p>
				{widened && (
					<p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
						<AlertTriangle className="mt-px size-3.5 shrink-0" />
						{mode === "escalated"
							? ESCALATED_REVIEW_WARNING
							: "This covers messages not shown in the list."}
					</p>
				)}
			</div>

			<dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface text-xs">
				<div className="flex justify-between gap-3 px-3 py-2">
					<dt className="text-fg-muted">Action</dt>
					<dd className="font-medium">{label}</dd>
				</div>
				<div className="flex justify-between gap-3 px-3 py-2">
					<dt className="shrink-0 text-fg-muted">Apply to</dt>
					<dd className="truncate font-medium">{matchSummary(description)}</dd>
				</div>
				{folder && (
					<div className="flex justify-between gap-3 px-3 py-2">
						<dt className="text-fg-muted">Destination</dt>
						<dd className="font-medium">{folder}</dd>
					</div>
				)}
				{scope && (
					<div className="flex justify-between gap-3 px-3 py-2">
						<dt className="text-fg-muted">Scope</dt>
						<dd className="font-medium">
							{scopeLabel(scope)}
							{scope === "until" && until ? ` · ${until}` : ""}
						</dd>
					</div>
				)}
				{ruleName !== undefined && (
					<div className="flex justify-between gap-3 px-3 py-2">
						<dt className="text-fg-muted">Rule name</dt>
						<dd className="truncate font-medium">{ruleName}</dd>
					</div>
				)}
			</dl>

			<SelectionSample {...sample} />
		</div>
	);
}

export interface RunStepProps {
	state: RunState;
	verb: Verb;
	scope?: RuleScope;
	/** How many messages the match reached. */
	matched: number;
	/** How many of them the action has covered so far. */
	applied: number;
	/** The messages the mail server rejected, named one by one. */
	failures: readonly WizardMessage[];
	/**
	 * How many the mail server rejected, when that is more than can be named. A
	 * server-side pass reports its own failure count without handing back the
	 * messages behind it; defaults to the ones named here.
	 */
	failedCount?: number;
	/**
	 * Why the commit never started, when the run knows and sending the same one
	 * again cannot change it. Stated in place of the generic ending, and in place
	 * of the retry that would fail identically (#522).
	 */
	failureReason?: string;
	onRetry: () => void;
	onDismiss: () => void;
	/**
	 * Ends the run. Leaving the screen and ending the run are two intents and
	 * two presses: the screen says the run keeps going once it is closed, so
	 * stopping it has to be asked for. Supplied only where there is something
	 * to stop — a server-side pass runs to its own end.
	 */
	onCancelRun?: () => void;
}

const runOutcomeOf = (props: RunStepProps): RunOutcome => ({
	state: props.state,
	verb: props.verb,
	scope: props.scope,
	matched: props.matched,
	applied: props.applied,
	failed: props.failedCount ?? props.failures.length,
	failureReason: props.failureReason,
});

const runIcon = (tone: RunCopy["tone"]): ReactNode => {
	if (tone === "progress") {
		return <Loader2 className="size-10 animate-spin text-accent" />;
	}
	if (tone === "warning")
		return <AlertTriangle className="size-10 text-warning" />;
	if (tone === "danger")
		return <AlertTriangle className="size-10 text-danger" />;
	return (
		<span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
			<Check className="size-6" />
		</span>
	);
};

export function RunStepBody(props: RunStepProps) {
	const { matched, applied, failures } = props;
	const outcome = runOutcomeOf(props);
	const copy = runCopy(outcome);
	// A stopped run never sent these, so nothing rejected them.
	const failureBadge =
		props.state === "runStopped" ? "Never sent" : "Server rejected";

	return (
		<div className="space-y-4 pt-2">
			<div className="flex flex-col items-center gap-3 py-6 text-center">
				{runIcon(copy.tone)}
				<p className="text-sm font-medium">{copy.title}</p>
				<p className="max-w-xs text-xs text-fg-muted">{copy.detail}</p>
			</div>

			{copy.showProgress && (
				<ProgressBar
					value={applied}
					max={matched}
					tone={outcome.failed > 0 ? "warning" : "success"}
				/>
			)}

			{failures.length > 0 && (
				<section className="rounded-lg border border-line bg-surface">
					<h2 className="border-b border-line px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
						{copy.failureListLabel}
					</h2>
					<ul className="divide-y divide-line">
						{failures.map((message) => (
							<li key={message.id} className="px-3 py-2">
								<p className="truncate text-xs font-medium">{message.sender}</p>
								<p className="truncate text-xs text-fg-muted">
									{message.subject}
								</p>
								<Badge className="mt-1" tone="warning">
									{failureBadge}
								</Badge>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

export function RunFooter(props: RunStepProps) {
	const { onRetry, onDismiss, onCancelRun } = props;
	const copy = runCopy(runOutcomeOf(props));

	// Closing is the movement the screen invites, so it keeps the primary place;
	// ending the run is the deliberate one beside it.
	if (copy.cancelLabel !== undefined && onCancelRun) {
		return (
			<div className="flex items-center gap-3">
				<Button
					variant="ghost"
					size="md"
					className="min-h-11 shrink-0"
					onClick={onCancelRun}
				>
					{copy.cancelLabel}
				</Button>
				<Button
					variant="primary"
					size="md"
					className="min-h-11 flex-1"
					onClick={onDismiss}
				>
					{copy.dismissLabel}
				</Button>
			</div>
		);
	}

	if (copy.retryLabel === undefined) {
		return (
			<Button
				variant={copy.tone === "progress" ? "ghost" : "primary"}
				size="touch"
				className="w-full"
				onClick={onDismiss}
			>
				{copy.dismissLabel}
			</Button>
		);
	}

	return (
		<div className="flex items-center gap-3">
			<Button variant="ghost" size="touch" onClick={onDismiss}>
				{copy.dismissLabel}
			</Button>
			<Button
				variant="primary"
				size="touch"
				className="flex-1"
				onClick={onRetry}
			>
				{copy.retryLabel}
			</Button>
		</div>
	);
}

const SCREEN_COPY: Record<StepId, { title?: string; subtitle?: string }> = {
	match: { subtitle: "What should this apply to?" },
	properties: {
		title: "Match properties",
		subtitle: "Which properties have to match?",
	},
	folder: { title: "Move to", subtitle: "Pick a destination" },
	rule: { title: "Organize", subtitle: "How long should this hold?" },
	name: { title: "Name the rule", subtitle: "So you can find it later" },
	review: { title: "Review", subtitle: "Check before it runs" },
	run: {},
};

export interface SelectionWizardProps {
	verb: Verb;
	steps: readonly StepId[];
	/**
	 * Held by id, so an answer that shortens the list cannot strand it. A step the
	 * current answers dropped resolves to the opening step, and the header, the
	 * rail and the body all read that one resolved step.
	 */
	step: StepId;
	/**
	 * Moves back one step. Not called on a step where Back leaves the wizard
	 * (`backExits`) — the opening step has nothing behind it, and the Run step's
	 * action has already happened — where `onExit` is called instead.
	 */
	onBack: () => void;
	onExit: () => void;
	onContinue: () => void;
	onCommit: () => void;
	/** What the current step is still missing. Dims Continue; never disables it. */
	blockedReason?: string;
	/** Continue was pressed while blocked, so the reason belongs on screen. */
	nudged?: boolean;
	match?: MatchStepProps;
	properties?: PropertiesStepProps;
	folder?: FolderStepProps;
	rule?: RuleStepProps;
	name?: NameStepProps;
	review?: ReviewStepProps;
	run?: RunStepProps;
}

const stepProps = <T,>(props: T | undefined, step: StepId): T => {
	if (props === undefined) {
		throw new Error(
			`The ${stepLabel(step)} step was rendered without its answers.`,
		);
	}
	return props;
};

/**
 * The whole wizard, driven from outside. It owns no state: the step, the answers
 * and every callback come in, so the same screens serve the app and the workbench
 * without either growing its own copy of them.
 */
export function SelectionWizard(props: SelectionWizardProps) {
	const { verb, steps, onExit, onContinue, onCommit } = props;
	const { label, destructive } = verbCopy(verb);
	// Resolved once. Rendering the header from the resolved step and the body
	// from the held one is how a rail and a screen come to disagree.
	const step = steps[stepIndex(steps, props.step)];
	const screen = SCREEN_COPY[step];
	const onBack = backExits(steps, step) ? onExit : props.onBack;

	const body = (): ReactNode => {
		if (step === "match")
			return <MatchStepBody {...stepProps(props.match, step)} />;
		if (step === "properties") {
			return <PropertiesStepBody {...stepProps(props.properties, step)} />;
		}
		if (step === "folder") {
			return <FolderStepBody {...stepProps(props.folder, step)} />;
		}
		if (step === "rule")
			return <RuleStepBody {...stepProps(props.rule, step)} />;
		if (step === "name") {
			return (
				<NameStepBody {...stepProps(props.name, step)} nudged={props.nudged} />
			);
		}
		if (step === "review") {
			return <ReviewStepBody {...stepProps(props.review, step)} />;
		}
		return <RunStepBody {...stepProps(props.run, step)} />;
	};

	const footer = (): ReactNode => {
		if (step === "run") return <RunFooter {...stepProps(props.run, step)} />;
		if (step === "review") {
			const review = stepProps(props.review, step);
			// The commit is a Continue like any other: a match that reaches nothing,
			// or a count still moving, dims it and says so rather than committing a
			// bulk action over nothing and reporting it as done.
			return (
				<FooterNav
					onBack={onBack}
					nextLabel={review.scope ? commitLabel(review.scope) : label}
					nextVariant={destructive ? "danger" : "primary"}
					onNext={onCommit}
					blockedReason={props.blockedReason}
					nudged={props.nudged}
				/>
			);
		}
		return (
			<FooterNav
				onBack={onBack}
				nextLabel="Continue"
				onNext={onContinue}
				blockedReason={props.blockedReason}
				nudged={props.nudged}
			/>
		);
	};

	const title = (): string => {
		if (step !== "run") return screen.title ?? label;
		return runCopy(runOutcomeOf(stepProps(props.run, step))).screenTitle;
	};

	// An escalated predicate is offered no doors, so the screen states what it
	// covers rather than asking a question with one answer.
	const subtitle =
		step === "match" && props.match?.mode === "escalated"
			? "What this applies to"
			: screen.subtitle;

	return (
		<WizardScreen
			title={title()}
			subtitle={subtitle}
			steps={steps}
			step={step}
			onBack={onBack}
			onExit={onExit}
			footer={footer()}
		>
			{body()}
		</WizardScreen>
	);
}
