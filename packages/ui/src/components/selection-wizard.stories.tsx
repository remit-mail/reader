import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import type { FolderTreeNode } from "../lib/folder-tree.js";
import { derivePropertyClauses } from "../lib/property-prefill.js";
import { suggestRuleName } from "../lib/rule-name.js";
import {
	type SearchConversion,
	searchConversionNotice,
} from "../lib/search-rule.js";
import { dominantSender, senderLabel } from "../lib/sender-derivation.js";
import {
	type MatchCount,
	type MatchDoor,
	type MatchMode,
	type RunState,
	ruleRestrictionFor,
	type SampleEmptyReason,
	type SelectionRestriction,
	type StepId,
	stepBlockedReason,
	stepIndex,
	stepsFor,
	type Verb,
	type WizardDraft,
	wizardScopeFor,
} from "../lib/wizard-steps.js";
import type { EnvelopeAddress } from "./address-display.js";
import {
	demoClauseSuggestions,
	type MatchOperator,
	type RuleClause,
	type RuleScope,
	ruleBlockedCopy,
	UNCOUNTABLE_PREDICATE_REASON,
} from "./filter-rule.js";
import type { ClauseEditState } from "./filter-rule-editor.js";
import { SelectionWizard } from "./selection-wizard.js";
import {
	PLAIN_CONVERSION,
	RICH_CONVERSION,
	SELECTION_FOLDERS,
	SELECTION_RECEIPTS_SAMPLE,
	SELECTION_SAMPLE,
	SELECTION_SEARCH_SAMPLE,
	type SelectionMessage,
} from "./selection-wizard-fixtures.js";

interface WizardEntry {
	verb: Verb;
	fromSearch?: boolean;
	startAt?: StepId;
	startMode?: MatchMode;
	escalatedScope?: string;
	escalatedTotal?: number;
	scope?: RuleScope;
	semanticUnavailable?: boolean;
	semanticOff?: boolean;
	semanticError?: string;
	restriction?: SelectionRestriction;
	runState?: RunState;
	runFailureReason?: string;
	failedBeyondNamed?: number;
	bodyTextClause?: boolean;
	sampleEmpty?: SampleEmptyReason;
	sampleLoading?: boolean;
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
	const seedPropertyClauses = () =>
		withIds(
			derivePropertyClauses(
				senders,
				selected.map((message) => message.subject),
			),
			"seed",
		);
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
		return mode === "properties" ? seedPropertyClauses() : [];
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
		Boolean(entry.semanticUnavailable || entry.semanticOff) &&
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
	const uncountable =
		mode === "properties" &&
		clauses.some((clause) => clause.field === "HasWords");
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
		widen: mode === "similar" ? { anchorCount: selected.length } : undefined,
		moveMailboxId: mailboxId,
		scope,
		until,
		name: ruleName,
	};
	const wizardScope = wizardScopeFor(
		entry.restriction === "spansAccounts" ? undefined : "acc-personal",
		entry.restriction,
	);
	const ruleRestriction = ruleRestrictionFor(mode, wizardScope);
	const stepRestriction =
		current === "folder"
			? wizardScope.destination
			: current === "rule" && (scope === "standing" || scope === "until")
				? ruleRestriction
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

	const changeMode = (next: MatchDoor) => {
		setMode(next);
		if (next === "properties" && clauses.length === 0) {
			setClauses(seedPropertyClauses());
		}
	};

	const fallBackToProperties = () => {
		setSemanticFallbackTaken(true);
		setClauses(seedPropertyClauses());
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
				onModeChange: changeMode,
				semanticUnavailable:
					entry.semanticUnavailable ||
					entry.semanticOff ||
					!!entry.semanticError,
				semanticOff: entry.semanticOff,
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
				sample: { ...sample, label: "What this matches" },
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
				restriction: ruleRestriction,
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

const exit = fn().mockName("onExit");

function Flow({
	messages = SELECTION_SAMPLE,
	conversion,
	preselected = 0,
	preselectedIds,
	openAt,
}: {
	messages?: SelectionMessage[];
	conversion?: SearchConversion;
	preselected?: number;
	preselectedIds?: string[];
	openAt: WizardEntry;
}) {
	const ids = preselectedIds ?? messages.slice(0, preselected).map((m) => m.id);
	return (
		<WizardDriver
			entry={openAt}
			selected={messages.filter((m) => ids.includes(m.id))}
			results={messages}
			conversion={conversion}
			onExit={exit}
		/>
	);
}

const meta: Meta = {
	title: "Design System/Mail/Selection wizard",
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

const shows =
	(present: (string | RegExp)[], absent: (string | RegExp)[] = []) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const canvas = within(canvasElement);
		for (const text of present) {
			const [match] = await canvas.findAllByText(
				typeof text === "string"
					? (_, element) =>
							element?.textContent === text &&
							![...element.children].some((child) => child.textContent === text)
					: text,
			);
			await expect(match).toBeVisible();
		}
		for (const text of absent) {
			await expect(canvas.queryAllByText(text)).toHaveLength(0);
		}
	};

const nameNewFolder = async (canvasElement: HTMLElement, name: string) => {
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole("button", { name: "New folder" }));
	await userEvent.type(await canvas.findByLabelText("Folder name"), name);
};

const createFolder = (canvasElement: HTMLElement) =>
	userEvent.click(
		within(canvasElement).getByRole("button", { name: "Create folder" }),
	);

const QUERY = "npm";
const MATCH_TOTAL = 1284;

const ONE_SENDER = ["m1", "m5", "m8"];

export const OrganizeApplyToDesktop: Story = {
	name: "Organize — apply to, desktop",
	play: shows([
		"What should this apply to?",
		"These 3 messages",
		"Similar to these 3",
	]),
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<Flow preselected={3} openAt={{ verb: "organize", startAt: "match" }} />
	),
};

export const SearchResultsDesktop: Story = {
	name: "Search results — ticked rows, desktop",
	play: shows(["These 4 messages", "4 messages match"]),
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			conversion={PLAIN_CONVERSION}
			preselected={4}
			openAt={{ verb: "organize", startAt: "match" }}
		/>
	),
};

export const SearchConverted: Story = {
	name: "Search — make this a filter",
	play: shows([
		/Your search was limited to Archive/,
		/aren't filter conditions/,
		"npm",
	]),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			conversion={RICH_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true }}
		/>
	),
};

export const SearchConvertedDesktop: Story = {
	name: "Search — make this a filter, desktop",
	play: shows([
		/Your search was limited to Archive/,
		/aren't filter conditions/,
		"npm",
	]),
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			conversion={RICH_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true }}
		/>
	),
};

export const SearchConvertedPlain: Story = {
	name: "Search — make this a filter, plain query",
	play: shows(
		["Which properties have to match?", "npm"],
		[/Your search was limited/],
	),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			conversion={PLAIN_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true }}
		/>
	),
};

export const SearchThenSelect: Story = {
	name: "Search — ticked rows, same wizard",
	play: shows(["These 3 messages", "npm: remit-ui@0.4.2 was published"]),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			conversion={RICH_CONVERSION}
			preselected={3}
			openAt={{ verb: "organize", startAt: "match" }}
		/>
	),
};

export const DeleteApplyTo: Story = {
	name: "Delete — apply to",
	play: shows([
		"What should this apply to?",
		"These 3 messages",
		"3 messages match",
	]),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "delete", startAt: "match" }} />
	),
};

export const DeleteProperties: Story = {
	name: "Delete — match properties",
	play: shows([
		"Which properties have to match?",
		"noreply@booking.com",
		"travel@expediamail.com",
	]),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "delete", startAt: "properties" }} />
	),
};

export const DeleteReview: Story = {
	name: "Delete — review",
	play: shows(["Delete 3 messages."]),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "delete", startAt: "review" }} />
	),
};

export const DeleteReviewDesktop: Story = {
	name: "Delete — review, desktop",
	play: shows(["Delete 3 messages."]),
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<Flow preselected={3} openAt={{ verb: "delete", startAt: "review" }} />
	),
};

export const DeleteReviewTablet: Story = {
	name: "Delete — review, tablet",
	play: shows(["Delete 3 messages."]),
	globals: { viewport: { value: "tablet" } },
	render: () => (
		<Flow preselected={3} openAt={{ verb: "delete", startAt: "review" }} />
	),
};

export const DeleteReviewSimilar: Story = {
	name: "Delete — review, similar to these",
	play: shows([
		"Delete mail similar to these 3.",
		"This covers messages not shown in the list.",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "delete", startAt: "review", startMode: "similar" }}
		/>
	),
};

export const DeleteDone: Story = {
	name: "Delete — done",
	play: shows(["Deleted 3", /Every message the match reached was deleted/]),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "delete", startAt: "run" }} />
	),
};

export const DeletePartialFailure: Story = {
	name: "Delete — partial failure",
	play: shows([
		"Not everything was deleted",
		"1 of 3 deleted · the mail server rejected 2.",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "delete", startAt: "run", runState: "backApplyFailed" }}
		/>
	),
};

export const MoveFolder: Story = {
	name: "Move — folder",
	play: shows(["Pick a destination", "Pick a destination first."]),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "move", startAt: "folder" }} />
	),
};

export const MoveNewFolder: Story = {
	name: "Move — new folder",
	render: () => (
		<Flow preselected={3} openAt={{ verb: "move", startAt: "folder" }} />
	),
	play: async ({ canvasElement }) => {
		await nameNewFolder(canvasElement, "Hotels");
		await expect(
			within(canvasElement).getByRole("button", { name: "Create folder" }),
		).toBeVisible();
	},
};

export const MoveNewFolderCreating: Story = {
	name: "Move — new folder, waiting for the server",
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "move",
				startAt: "folder",
				folderCreate: "never confirms",
			}}
		/>
	),
	play: async ({ canvasElement }) => {
		await nameNewFolder(canvasElement, "Hotels");
		await createFolder(canvasElement);
		await expect(
			await within(canvasElement).findByText(
				"Waiting for the mail server to confirm the folder…",
			),
		).toBeVisible();
	},
};

export const MoveNewFolderCreateFailed: Story = {
	name: "Move — new folder, create failed",
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "move", startAt: "folder", folderCreate: "fails" }}
		/>
	),
	play: async ({ canvasElement }) => {
		await nameNewFolder(canvasElement, "Hotels");
		await createFolder(canvasElement);
		await expect(
			await within(canvasElement).findByText(
				"The mail server refused the folder. Please try again.",
			),
		).toBeVisible();
	},
};

export const MoveReview: Story = {
	name: "Move — review",
	play: shows(["Move 3 messages."]),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "move", startAt: "review" }} />
	),
};

export const MarkReadReview: Story = {
	name: "Mark read — review",
	play: shows(["Mark read 20 messages."]),
	render: () => (
		<Flow
			preselected={SELECTION_SAMPLE.length}
			openAt={{ verb: "markRead", startAt: "review" }}
		/>
	),
};

export const OrganizeApplyTo: Story = {
	name: "Organize — apply to",
	play: shows(["What should this apply to?", "3 messages match"]),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "organize", startAt: "match" }} />
	),
};

export const OrganizeSimilarDoor: Story = {
	name: "Organize — similar to these",
	play: shows([
		"Similar to these 3",
		"The first matches. The total is not known until the run finishes.",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match", startMode: "similar" }}
		/>
	),
};

export const OrganizePropertyDoor: Story = {
	name: "Organize — match on properties",
	play: shows([
		"Its properties",
		"The first matches. The total is not known until the run finishes.",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match", startMode: "properties" }}
		/>
	),
};

export const OrganizeSemanticUnavailable: Story = {
	name: "Organize — similar unavailable",
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match", semanticUnavailable: true }}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByText("Similar to these 3"));
		await expect(
			await canvas.findByText(
				"Similar-mail matching is unavailable right now — matching on the senders instead.",
			),
		).toBeVisible();
	},
};

export const OrganizeSemanticOff: Story = {
	name: "Organize — semantic search off",
	play: shows([/Semantic search is off on this instance/, /remit semantic on/]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "organize", startAt: "match", semanticOff: true }}
		/>
	),
};

export const OrganizeSenderFallback: Story = {
	name: "Organize — sender fallback, addresses",
	play: shows([
		"Similar-mail matching is unavailable right now. These are the senders of the messages you picked.",
		"automated@airbnb.com",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "properties",
				semanticUnavailable: true,
			}}
		/>
	),
};

export const OrganizeSenderFallbackDomain: Story = {
	name: "Organize — sender fallback, one domain",
	play: shows([
		"npmjs.com",
		"Similar-mail matching is unavailable right now. These are the senders of the messages you picked.",
	]),
	render: () => (
		<Flow
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

export const OrganizeSenderFallbackStanding: Story = {
	name: "Organize — sender fallback, standing",
	play: shows(["So you can find it later", "Rule name"]),
	render: () => (
		<Flow
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

export const OrganizePropertiesSender: Story = {
	name: "Organize — properties, one sender",
	play: shows(["noreply@booking.com", "How was your stay?"]),
	render: () => (
		<Flow
			preselectedIds={ONE_SENDER}
			openAt={{ verb: "organize", startAt: "properties" }}
		/>
	),
};

export const OrganizePropertiesSubject: Story = {
	name: "Organize — properties, shared subject",
	play: shows(["Your receipt from", "Your receipt from Sightglass #77"]),
	render: () => (
		<Flow
			messages={SELECTION_RECEIPTS_SAMPLE}
			preselected={3}
			openAt={{ verb: "organize", startAt: "properties" }}
		/>
	),
};

export const OrganizeNothingMatches: Story = {
	name: "Organize — nothing matches",
	play: shows([
		"Nothing matches this yet. Widen a property, or match on a different one.",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "properties",
				sampleEmpty: "noMatch",
			}}
		/>
	),
};

export const OrganizeUncountable: Story = {
	name: "Organize — the count that can't be taken",
	play: shows(
		["Has the words", /only a saved rule does/],
		[
			"Nothing matches this yet. Widen a property, or match on a different one.",
		],
	),
	render: () => (
		<Flow
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

export const OrganizeNothingIndexed: Story = {
	name: "Organize — nothing indexed",
	play: shows([
		"This mail isn't indexed yet, so nothing can be counted. The rule still matches once indexing catches up.",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "properties",
				sampleEmpty: "notIndexed",
			}}
		/>
	),
};

export const OrganizeScope: Story = {
	name: "Organize — scope",
	play: shows(["How long should this hold?", "Choose one of the three first."]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "organize", startAt: "rule", startMode: "similar" }}
		/>
	),
};

export const OrganizeStanding: Story = {
	name: "Organize — keep doing this",
	play: shows(
		["How long should this hold?", "Keep doing this"],
		["Choose one of the three first."],
	),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "rule",
				startMode: "similar",
				scope: "standing",
			}}
		/>
	),
};

export const OrganizeUntil: Story = {
	name: "Organize — until a date",
	play: shows(["Stops on", "Pick the date this rule should stop on."]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "rule",
				startMode: "similar",
				scope: "until",
			}}
		/>
	),
};

export const OrganizeStandingNoPredicate: Story = {
	name: "Organize — keep doing this, nothing to match on",
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "organize", startAt: "rule", scope: "standing" }}
		/>
	),
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", { name: "Continue" }),
		);
		const announced = within(canvasElement)
			.getAllByRole("status")
			.some((region) => region.textContent === ruleBlockedCopy.noMatch);
		await expect(announced).toBe(true);
	},
};

export const OrganizeScopeBodyText: Story = {
	name: "Organize — scope, has the words",
	play: shows([/Applying once can't read message bodies/]),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			conversion={PLAIN_CONVERSION}
			openAt={{ verb: "organize", fromSearch: true, startAt: "rule" }}
		/>
	),
};

export const OrganizeName: Story = {
	name: "Organize — name the rule",
	play: shows(["So you can find it later", "Rule name"]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{ verb: "organize", startAt: "name", startMode: "similar" }}
		/>
	),
};

export const OrganizeReviewStanding: Story = {
	name: "Organize — review, standing",
	play: shows([
		"Organize mail similar to these 3 and save a rule that keeps doing it.",
		"Mail from Booking.com",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "review",
				startMode: "similar",
				scope: "standing",
			}}
		/>
	),
};

export const RunSaving: Story = {
	name: "Run — saving",
	play: shows(["Saving rule…", "Nothing has been changed yet."]),
	render: () => (
		<Flow
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

export const RunBackApplyInFlight: Story = {
	name: "Run — back-apply in flight",
	play: shows([
		"Rule saved. Moving the mail already in your mailbox…",
		"This keeps running if you close the wizard.",
	]),
	render: () => (
		<Flow
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
	play: shows(["Rule saved and applied"]),
	render: () => (
		<Flow
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

export const RunBackApplyFailed: Story = {
	name: "Run — back-apply failed",
	play: shows([
		"Rule saved — some mail stayed put",
		"1 of 3 organized · the mail server rejected 2. The rule itself is saved and keeps working on new mail.",
	]),
	render: () => (
		<Flow
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

export const RunBackApplyStartFailed: Story = {
	name: "Run — back-apply start failed",
	play: shows(["Rule saved", "Run it over existing mail"]),
	render: () => (
		<Flow
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

export const RunBackApplyRestartFailed: Story = {
	name: "Run — back-apply restart failed",
	play: shows(["Rule saved — the retry didn't start"]),
	render: () => (
		<Flow
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

export const RunStatusUnknown: Story = {
	name: "Run — status unknown",
	play: shows([
		"Rule saved. Its progress over your existing mail is unknown",
		"Check again",
	]),
	render: () => (
		<Flow
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

export const RunFilterSaved: Story = {
	name: "Run — filter saved",
	play: shows(["Filter saved"]),
	render: () => (
		<Flow
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

export const RunCommitFailed: Story = {
	name: "Run — commit failed",
	play: shows(["Couldn't save the rule", "Nothing has changed.", "Try again"]),
	render: () => (
		<Flow
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

export const RunNoDestination: Story = {
	name: "Run — nowhere to file into",
	play: shows(
		["Couldn't start junk", /no Junk folder appointed/],
		["Try again"],
	),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "junk",
				startAt: "run",
				scope: "once",
				runState: "commitFailed",
				runFailureReason:
					"This account has no Junk folder appointed, so there is nowhere to file these. Appoint one under Settings › Folder roles.",
			}}
		/>
	),
};

export const RunAnotherIsGoing: Story = {
	name: "Run — another run is still going",
	play: shows(
		["Couldn't start delete", /still running — stop it first/],
		["Try again"],
	),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "delete",
				startAt: "run",
				scope: "once",
				runState: "commitFailed",
				runFailureReason:
					"A delete of 1,284 messages in Inbox is still running — stop it first.",
			}}
		/>
	),
};

export const RunOnceDone: Story = {
	name: "Run — one-off done",
	play: shows(["Organized 3"]),
	render: () => (
		<Flow
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

export const CrossAccountDestination: Story = {
	name: "Folder — selection spans accounts",
	play: shows([/A destination only works within one account/]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "folder",
				restriction: "spansAccounts",
			}}
		/>
	),
};

export const CrossFolderDestination: Story = {
	name: "Folder — selection spans folders",
	play: shows([/A destination only works within one folder/]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "folder",
				restriction: "spansFolders",
			}}
		/>
	),
};

export const UnrestrictedDestination: Story = {
	name: "Folder — one account, one folder",
	play: shows(
		["Tap a folder to open it, or make a new one where you want it."],
		[/only works within/],
	),
	render: () => (
		<Flow preselected={3} openAt={{ verb: "organize", startAt: "folder" }} />
	),
};

export const CrossAccountMatch: Story = {
	name: "Apply to — selection spans accounts",
	play: shows(
		[/Matching beyond the messages you picked only works within one account/],
		["Similar to these 3"],
	),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "match",
				restriction: "spansAccounts",
			}}
		/>
	),
};

export const CrossFolderMatch: Story = {
	name: "Apply to — selection spans folders",
	play: shows(["Similar to these 3", "Its properties"], [/only works within/]),
	render: () => (
		<Flow
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
	play: shows([/A rule only works within one account/]),
	render: () => (
		<Flow
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
	play: shows([/A rule only works within one folder/]),
	render: () => (
		<Flow
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

export const MatchWidenFailed: Story = {
	name: "Apply to — the widen failed",
	play: shows([
		"Couldn't find similar messages: The matcher is not reachable right now.",
	]),
	render: () => (
		<Flow
			preselected={3}
			openAt={{
				verb: "organize",
				startAt: "match",
				semanticError: "The matcher is not reachable right now.",
			}}
		/>
	),
};

export const MatchSampleLoading: Story = {
	name: "Apply to — the sample is still arriving",
	play: shows(["Fetching the messages this covers…"]),
	render: () => (
		<Flow
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

export const RunFailedBeyondNamed: Story = {
	name: "Run — more rejected than can be named",
	play: shows([/the mail server rejected 9/, "Retry 9"]),
	render: () => (
		<Flow
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

const ESCALATED_SCOPE = `matching "${QUERY}"`;

const escalatedEntry = (verb: Verb, startAt: StepId): WizardEntry => ({
	verb,
	startAt,
	escalatedScope: ESCALATED_SCOPE,
	escalatedTotal: MATCH_TOTAL,
});

export const EscalatedApplyTo: Story = {
	name: "Select all matching — apply to",
	play: shows(["What this applies to", 'Every message matching "npm"']),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={4}
			openAt={escalatedEntry("delete", "match")}
		/>
	),
};

export const EscalatedReview: Story = {
	name: "Select all matching — review",
	play: shows(['Delete all 1,284 messages matching "npm".']),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={4}
			openAt={escalatedEntry("delete", "review")}
		/>
	),
};

export const EscalatedReviewDesktop: Story = {
	name: "Select all matching — review, desktop",
	play: shows(['Delete all 1,284 messages matching "npm".']),
	globals: { viewport: { value: "desktop" } },
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={4}
			openAt={escalatedEntry("delete", "review")}
		/>
	),
};

export const EscalatedRuleRestricted: Story = {
	name: "Select all matching — scope, no rule to save",
	play: shows([/A match this wide applies once/]),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={4}
			openAt={escalatedEntry("organize", "rule")}
		/>
	),
};

export const EscalatedMoveFolder: Story = {
	name: "Select all matching — move, folder",
	play: shows(["Pick a destination", "Archive"]),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={4}
			openAt={escalatedEntry("move", "folder")}
		/>
	),
};

export const EscalatedRunning: Story = {
	name: "Select all matching — running",
	play: shows(["Deleting 12 messages…", "Stop the run"]),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={4}
			openAt={{
				...escalatedEntry("delete", "run"),
				runState: "backApplyRunning",
			}}
		/>
	),
};

export const EscalatedStopped: Story = {
	name: "Select all matching — stopped part-way",
	play: shows(["Stopped after 10", /10 of 12 deleted/]),
	render: () => (
		<Flow
			messages={SELECTION_SEARCH_SAMPLE}
			preselected={4}
			openAt={{
				...escalatedEntry("delete", "run"),
				runState: "runStopped",
			}}
		/>
	),
};
