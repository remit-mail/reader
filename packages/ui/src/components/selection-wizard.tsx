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
	FolderInput,
	FolderPlus,
	Loader2,
	Plus,
	X,
} from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useId } from "react";
import { cn } from "../lib/cn.js";
import {
	folderDepth,
	folderLeaf,
	type MatchMode,
	matchDoorHint,
	matchDoorLabel,
	matchPhrase,
	matchSummary,
	orderFolders,
	type RunCopy,
	type RunState,
	runCopy,
	type SampleEmptyReason,
	type StepId,
	sampleEmptyCopy,
	stepIndex,
	stepLabel,
	type Verb,
	verbCopy,
} from "../lib/wizard-steps.js";
import { Badge } from "./badge.js";
import { Button } from "./button.js";
import { FieldLabel } from "./field-label.js";
import {
	type ClauseField,
	clauseFieldHint,
	clauseFieldLabel,
	clauseFieldOrder,
	commitLabel,
	type MatchOperator,
	matchesBodyText,
	matchJoinWord,
	matchOperatorLabel,
	type RuleClause,
	type RuleScope,
	scopeLabel,
} from "./filter-rule.js";
import { Input } from "./input.js";
import { ProgressBar } from "./progress-bar.js";
import type { SearchConversionNotice } from "./search-conversion.js";
import { SearchConversionNoticeView } from "./search-conversion-notice.js";
import { Select } from "./select.js";

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
	const active = stepIndex(steps, step);
	return (
		<ol className="flex items-center gap-1.5" aria-label="Progress">
			{steps.map((id, i) => (
				<li key={id} className="flex flex-1 items-center gap-1.5">
					<span
						className={cn(
							"h-1 flex-1 rounded-full transition-colors",
							i <= active ? "bg-accent" : "bg-surface-sunken",
						)}
						aria-current={i === active ? "step" : undefined}
					/>
				</li>
			))}
		</ol>
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
	const active = stepIndex(steps, step);
	return (
		<div className="fixed inset-0 z-50 flex flex-col font-sans text-fg md:items-center md:justify-center md:bg-black/40 md:p-6">
			<div className="flex min-h-0 w-full flex-1 flex-col bg-canvas md:h-[45rem] md:max-h-[calc(100dvh-3rem)] md:w-[35rem] md:max-w-[calc(100vw-3rem)] md:flex-none md:overflow-hidden md:rounded-xl md:border md:border-line md:shadow-lg">
				<header className="shrink-0 border-b border-line px-3 pb-2 pt-3">
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={onBack}
							aria-label="Back"
							className="flex size-11 items-center justify-center rounded-md text-fg-muted"
						>
							<ArrowLeft className="size-5" />
						</button>
						<div className="min-w-0 flex-1 text-center">
							<h1 className="truncate text-sm font-semibold">{title}</h1>
							{subtitle && (
								<p className="truncate text-2xs text-fg-muted">{subtitle}</p>
							)}
						</div>
						<button
							type="button"
							onClick={onExit}
							aria-label="Cancel"
							className="flex size-11 items-center justify-center rounded-md text-fg-muted"
						>
							<X className="size-5" />
						</button>
					</div>
					<div className="space-y-1 px-1 pt-2">
						<StepRail steps={steps} step={step} />
						<p className="text-2xs text-fg-subtle">
							Step {active + 1} of {steps.length} · {stepLabel(steps[active])}
						</p>
					</div>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
					{children}
				</div>

				<footer className="shrink-0 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3">
					{footer}
				</footer>
			</div>
		</div>
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

export function ChoiceCard({
	selected,
	title,
	description,
	unavailable,
	onSelect,
	children,
}: ChoiceCardProps) {
	return (
		<div className="space-y-1.5">
			<button
				type="button"
				onClick={onSelect}
				aria-pressed={selected}
				aria-disabled={unavailable || undefined}
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
			{children}
		</div>
	);
}

export interface SelectionSampleProps {
	messages: readonly WizardMessage[];
	/**
	 * How many the match covers. Absent for a widened door, which carries no count
	 * until it has run — the sample then says the total is not yet known.
	 */
	total?: number;
	label: string;
	/** Why there are no rows. Defaults to nothing matching, never to a bare empty state. */
	emptyReason?: SampleEmptyReason;
}

/**
 * The members of the match, closing every screen that names one. A named match
 * with no members shown is an unseen bulk action, so the rows scroll in their own
 * bounded region rather than truncating.
 */
export function SelectionSample({
	messages,
	total,
	label,
	emptyReason,
}: SelectionSampleProps) {
	return (
		<section className="flex flex-col rounded-lg border border-line bg-surface">
			<h2 className="shrink-0 border-b border-line px-3 py-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
				{label}
			</h2>
			{messages.length === 0 ? (
				<p className="px-3 py-4 text-xs text-fg-muted">
					{sampleEmptyCopy(emptyReason ?? "noMatch")}
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
					{total === undefined ? (
						<p className="shrink-0 border-t border-line px-3 py-2 text-2xs text-fg-subtle">
							The first matches. The total is not known until the run finishes.
						</p>
					) : (
						total > messages.length && (
							<p className="shrink-0 border-t border-line px-3 py-2 text-2xs text-fg-subtle">
								and {total - messages.length} more
							</p>
						)
					)}
				</>
			)}
		</section>
	);
}

export interface FooterNavProps {
	backLabel?: string;
	onBack: () => void;
	nextLabel: string;
	onNext: () => void;
	nextVariant?: "primary" | "danger";
	/** What the step is still missing. Dims the control; never disables it. */
	blockedReason?: string;
	/** Continue was pressed while blocked, so the reason is on screen. */
	nudged?: boolean;
}

export function FooterNav({
	backLabel = "Back",
	onBack,
	nextLabel,
	onNext,
	nextVariant = "primary",
	blockedReason,
	nudged,
}: FooterNavProps) {
	return (
		<div className="space-y-2">
			{nudged && blockedReason && (
				<p role="status" className="px-1 text-2xs text-warning">
					{blockedReason}
				</p>
			)}
			<div className="flex items-center gap-3">
				<Button
					variant="ghost"
					size="touch"
					onClick={onBack}
					icon={<ArrowLeft className="size-4" />}
					className="shrink-0"
				>
					{backLabel}
				</Button>
				<Button
					variant={nextVariant}
					size="touch"
					onClick={onNext}
					aria-disabled={blockedReason ? true : undefined}
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
	onModeChange: (mode: MatchMode) => void;
	/**
	 * Similar-mail matching cannot run right now. A runtime state, not a property
	 * of the deployment: the door stays pressable and dimmed.
	 */
	semanticUnavailable?: boolean;
	/** The dimmed door was pressed and the senders were filled in instead. */
	semanticFallbackTaken?: boolean;
	onSemanticFallback: () => void;
	sample: SelectionSampleProps;
}

export function MatchStepBody({
	selectedCount,
	mode,
	onModeChange,
	semanticUnavailable,
	semanticFallbackTaken,
	onSemanticFallback,
	sample,
}: MatchStepProps) {
	return (
		<>
			<div className="space-y-2">
				<ChoiceCard
					selected={mode === "selected"}
					onSelect={() => onModeChange("selected")}
					title={matchDoorLabel("selected", selectedCount)}
					description={matchDoorHint("selected")}
				/>
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
					{semanticFallbackTaken && (
						<p role="status" className="px-1 text-2xs text-fg-subtle">
							Similar-mail matching is unavailable right now — matching on the
							senders instead.
						</p>
					)}
				</ChoiceCard>
				<ChoiceCard
					selected={mode === "properties"}
					onSelect={() => onModeChange("properties")}
					title={matchDoorLabel("properties", selectedCount)}
					description={matchDoorHint("properties")}
				/>
			</div>
			<div className="mt-4">
				<SelectionSample {...sample} />
			</div>
		</>
	);
}

const CLAUSE_PLACEHOLDER: Record<ClauseField, string> = {
	From: "noreply@booking.com",
	Subject: "Booking confirmation",
	HasWords: "boarding pass",
	ListId: "python-dev.python.org",
	FromDomain: "booking.com",
};

function ClauseRow({
	clause,
	onChange,
	onRemove,
}: {
	clause: RuleClause;
	onChange: (next: RuleClause) => void;
	onRemove: () => void;
}) {
	const label = clauseFieldLabel(clause.field);
	const hint = clauseFieldHint(clause.field);
	return (
		<div className="space-y-2 rounded-lg border border-line bg-surface p-2">
			<div className="flex items-center gap-2">
				<Select
					aria-label="Property"
					value={clause.field}
					onChange={(event) =>
						onChange({ ...clause, field: event.target.value as ClauseField })
					}
					className="h-9 min-w-0 flex-1"
				>
					{clauseFieldOrder.map((field) => (
						<option key={field} value={field}>
							{clauseFieldLabel(field)}
						</option>
					))}
				</Select>
				<Input
					aria-label={`${label} value`}
					value={clause.value}
					placeholder={CLAUSE_PLACEHOLDER[clause.field]}
					autoComplete="off"
					onChange={(event) =>
						onChange({ ...clause, value: event.target.value })
					}
					className="h-9 min-w-0 flex-1"
				/>
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove the ${label} property`}
					className="flex size-9 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg"
				>
					<X className="size-4" />
				</button>
			</div>
			{clause.derived && (
				<p className="px-1 text-2xs text-fg-subtle">
					Taken from the messages you picked. Change it or take it off.
				</p>
			)}
			{hint && <p className="px-1 text-2xs text-fg-subtle">{hint}</p>}
		</div>
	);
}

export interface PropertiesStepProps {
	clauses: readonly RuleClause[];
	matchOperator: MatchOperator;
	onMatchOperatorChange: (operator: MatchOperator) => void;
	onClauseChange: (clause: RuleClause) => void;
	onClauseRemove: (id: string) => void;
	onClauseAdd: () => void;
	/** What converting a search left behind, when a query is what opened this. */
	conversionNotice?: SearchConversionNotice;
	/** The similar door was dimmed and these are the senders it fell back to. */
	semanticFallbackTaken?: boolean;
	sample: SelectionSampleProps;
}

export function PropertiesStepBody({
	clauses,
	matchOperator,
	onMatchOperatorChange,
	onClauseChange,
	onClauseRemove,
	onClauseAdd,
	conversionNotice,
	semanticFallbackTaken,
	sample,
}: PropertiesStepProps) {
	return (
		<div className="space-y-3">
			{semanticFallbackTaken && (
				<p role="status" className="px-1 text-xs text-fg-muted">
					Similar-mail matching is unavailable right now. These are the senders
					of the messages you picked.
				</p>
			)}

			{conversionNotice && (
				<SearchConversionNoticeView notice={conversionNotice} />
			)}

			{clauses.length > 1 && (
				<Select
					aria-label="How the properties combine"
					value={matchOperator}
					onChange={(event) =>
						onMatchOperatorChange(event.target.value as MatchOperator)
					}
					className="h-9 w-full"
				>
					<option value="all">{matchOperatorLabel("all")}</option>
					<option value="any">{matchOperatorLabel("any")}</option>
				</Select>
			)}

			{clauses.map((clause, i) => (
				<div key={clause.id} className="space-y-3">
					{i > 0 && (
						<p className="px-1 text-2xs font-medium uppercase tracking-wide text-fg-subtle">
							{matchJoinWord(matchOperator)}
						</p>
					)}
					<ClauseRow
						clause={clause}
						onChange={onClauseChange}
						onRemove={() => onClauseRemove(clause.id)}
					/>
				</div>
			))}

			<Button
				variant="secondary"
				size="touch"
				onClick={onClauseAdd}
				icon={<Plus className="size-4" />}
				className="w-full"
			>
				Add another property
			</Button>

			<p className="px-1 text-xs text-fg-muted">
				We started you off from what you were looking at. Change any of it —
				this is where the rule is decided, not the list behind it.
			</p>

			<SelectionSample {...sample} />
		</div>
	);
}

/** Where the inline new-folder form is anchored, the parent it will use, and its name. */
export interface FolderDraft {
	/** The folder row the form opened from; "" anchors it under the New folder action. */
	anchor: string;
	/** "" means top level. */
	parent: string;
	name: string;
}

export interface FolderStepProps {
	folders: readonly string[];
	folder?: string;
	onFolderSelect: (path: string) => void;
	draft?: FolderDraft;
	onDraftOpen: (anchor: string) => void;
	onDraftChange: (draft: FolderDraft) => void;
	onDraftClose: () => void;
	onCreate: () => void;
	/**
	 * The mail server has not confirmed the folder yet. Creating one is an IMAP
	 * mutation and the move that follows waits for it, so the step shows the wait
	 * rather than offering a folder that may not exist.
	 */
	creating?: boolean;
	/** Why the folder could not be created, stated on the step that tried. */
	createError?: string;
	draftInputRef?: Ref<HTMLInputElement>;
}

export function FolderStepBody({
	folders,
	folder,
	onFolderSelect,
	draft,
	onDraftOpen,
	onDraftChange,
	onDraftClose,
	onCreate,
	creating,
	createError,
	draftInputRef,
}: FolderStepProps) {
	const nameId = useId();
	const parentId = useId();
	const ordered = orderFolders(folders);

	const draftForm = draft && (
		<div className="space-y-3 border-t border-line bg-surface-sunken px-3 py-3">
			<div>
				<FieldLabel htmlFor={nameId}>Folder name</FieldLabel>
				<Input
					id={nameId}
					ref={draftInputRef}
					value={draft.name}
					placeholder="Hotels"
					onChange={(event) =>
						onDraftChange({ ...draft, name: event.target.value })
					}
				/>
			</div>
			<div>
				<FieldLabel htmlFor={parentId}>Inside</FieldLabel>
				<Select
					id={parentId}
					value={draft.parent}
					onChange={(event) =>
						onDraftChange({ ...draft, parent: event.target.value })
					}
				>
					<option value="">Top level</option>
					{ordered.map((path) => (
						<option key={path} value={path}>
							{path}
						</option>
					))}
				</Select>
			</div>
			{createError && (
				<p role="status" className="text-2xs text-danger">
					{createError}
				</p>
			)}
			{creating && (
				<p
					role="status"
					className="flex items-center gap-2 text-2xs text-fg-muted"
				>
					<Loader2 className="size-3.5 animate-spin" />
					Waiting for the mail server to confirm the folder…
				</p>
			)}
			<div className="flex items-center gap-2">
				<Button variant="ghost" onClick={onDraftClose} className="shrink-0">
					Cancel
				</Button>
				<Button variant="primary" onClick={onCreate} className="flex-1">
					Create folder
				</Button>
			</div>
		</div>
	);

	return (
		<div className="overflow-hidden rounded-lg border border-line bg-surface">
			<button
				type="button"
				onClick={() => onDraftOpen("")}
				className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm font-medium text-accent hover:bg-surface-sunken"
			>
				<FolderPlus className="size-4 shrink-0" />
				New folder
			</button>
			{draft?.anchor === "" && draftForm}
			<ul className="divide-y divide-line border-t border-line">
				{ordered.map((path) => (
					<li key={path}>
						<div className="flex items-center">
							<button
								type="button"
								onClick={() => onFolderSelect(path)}
								className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left text-sm hover:bg-surface-sunken"
							>
								{folderDepth(path) > 0 && (
									<span
										aria-hidden
										className="shrink-0"
										style={{ width: folderDepth(path) * 14 }}
									/>
								)}
								<FolderInput className="size-4 shrink-0 text-fg-subtle" />
								<span className="min-w-0 flex-1 truncate">
									{folderLeaf(path)}
								</span>
								{folder === path && <Check className="size-4 text-accent" />}
							</button>
							<button
								type="button"
								onClick={() => onDraftOpen(path)}
								aria-label={`New folder inside ${path}`}
								title={`New folder inside ${path}`}
								className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-sunken hover:text-fg"
							>
								<FolderPlus className="size-4" />
							</button>
						</div>
						{draft?.anchor === path && draftForm}
					</li>
				))}
			</ul>
		</div>
	);
}

export interface RuleStepProps {
	scope?: RuleScope;
	onScopeChange: (scope: RuleScope) => void;
	/** ISO 8601 civil date (`YYYY-MM-DD`). */
	until: string;
	onUntilChange: (until: string) => void;
	/**
	 * The rule's clauses. A `HasWords` clause is only readable by the index-time
	 * matcher, so this is where a one-time apply says it cannot serve one.
	 */
	clauses: readonly RuleClause[];
}

export function RuleStepBody({
	scope,
	onScopeChange,
	until,
	onUntilChange,
	clauses,
}: RuleStepProps) {
	const untilId = useId();
	const bodyText = clauses.some((clause) => matchesBodyText(clause.field));

	return (
		<div className="space-y-2">
			<ChoiceCard
				selected={scope === "once"}
				onSelect={() => onScopeChange("once")}
				title={scopeLabel("once")}
				description="A one-off tidy-up. Nothing changes for future mail."
			>
				{bodyText && (
					<p className="px-1 text-2xs text-warning">
						Applying once can't read message bodies, and this rule matches on
						the words inside them. Keep doing this instead, and the rule reads
						every message as it is indexed.
					</p>
				)}
			</ChoiceCard>
			<ChoiceCard
				selected={scope === "standing"}
				onSelect={() => onScopeChange("standing")}
				title={scopeLabel("standing")}
				description="Saves a rule and applies it to new mail as it arrives, and to the mail already in your mailbox. You'll name it next."
			/>
			<ChoiceCard
				selected={scope === "until"}
				onSelect={() => onScopeChange("until")}
				title={scopeLabel("until")}
				description="The same rule, and it stops on a day you pick."
			>
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
	inputRef?: Ref<HTMLInputElement>;
}

export function NameStepBody({ name, onNameChange, inputRef }: NameStepProps) {
	const nameId = useId();
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
							onClick={() => onNameChange("")}
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
	sample,
}: ReviewStepProps) {
	const { label } = verbCopy(verb);
	const description = { mode, selectedCount, clauses, matchOperator };
	const widened = mode !== "selected";
	const persists = scope === "standing" || scope === "until";

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-line bg-surface p-3">
				<p className="text-sm text-fg">
					<span className="font-semibold">{label}</span>{" "}
					{matchPhrase(description)}
					{verb === "move" && folder ? ` to ${folder}` : ""}
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
						This covers messages not shown in the list.
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
	onRetry: () => void;
	onDismiss: () => void;
}

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

export function RunStepBody({
	state,
	verb,
	scope,
	matched,
	applied,
	failures,
}: RunStepProps) {
	const copy = runCopy({
		state,
		verb,
		scope,
		matched,
		applied,
		failed: failures.length,
	});

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
					tone={failures.length > 0 ? "warning" : "success"}
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
									Server rejected
								</Badge>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

export function RunFooter({
	state,
	verb,
	scope,
	matched,
	applied,
	failures,
	onRetry,
	onDismiss,
}: RunStepProps) {
	const copy = runCopy({
		state,
		verb,
		scope,
		matched,
		applied,
		failed: failures.length,
	});

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
	/** Held by id, so an answer that shortens the list cannot strand it. */
	step: StepId;
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
	const { verb, steps, step, onBack, onExit, onContinue, onCommit } = props;
	const { label, destructive } = verbCopy(verb);
	const screen = SCREEN_COPY[step];

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
		if (step === "name")
			return <NameStepBody {...stepProps(props.name, step)} />;
		if (step === "review") {
			return <ReviewStepBody {...stepProps(props.review, step)} />;
		}
		return <RunStepBody {...stepProps(props.run, step)} />;
	};

	const footer = (): ReactNode => {
		if (step === "run") return <RunFooter {...stepProps(props.run, step)} />;
		if (step === "review") {
			const review = stepProps(props.review, step);
			return (
				<FooterNav
					onBack={onBack}
					nextLabel={review.scope ? commitLabel(review.scope) : label}
					nextVariant={destructive ? "danger" : "primary"}
					onNext={onCommit}
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

	return (
		<WizardScreen
			title={screen.title ?? label}
			subtitle={screen.subtitle}
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
