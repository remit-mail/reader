import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { StepId } from "../lib/wizard-steps.js";
import { stepsFor } from "../lib/wizard-steps.js";
import type { PreviewCount, RuleClause } from "./filter-rule.js";
import {
	FolderStepBody,
	MatchStepBody,
	NameStepBody,
	PropertiesStepBody,
	ReviewStepBody,
	RuleStepBody,
	RunFooter,
	RunStepBody,
	SelectionSample,
	SelectionWizard,
	type SelectionWizardProps,
	type WizardMessage,
	type WizardScreenProps,
} from "./selection-wizard.js";

const noop = () => {};

/** The rendered markup with the server renderer's text-node separators taken out. */
const text = (html: string): string => html.replaceAll("<!-- -->", "");

const messages: WizardMessage[] = [
	{
		id: "m1",
		sender: "Booking.com",
		subject: "Booking confirmation: Hotel Bairro Alto",
		date: "Jul 2",
	},
	{
		id: "m2",
		sender: "Airbnb",
		subject: "Your reservation is confirmed",
		date: "Jun 28",
	},
];

const clauses: RuleClause[] = [
	{ id: "c1", field: "From", value: "noreply@booking.com", derived: true },
	{ id: "c2", field: "Subject", value: "confirmation" },
];

const counted = (count: number): PreviewCount => ({ status: "ready", count });

const sample = { messages, preview: counted(2), label: "Your selection" };

const matchProps = {
	selectedCount: 2,
	mode: "selected" as const,
	onModeChange: noop,
	onSemanticFallback: noop,
	sample,
};

const propertiesProps = {
	clauses,
	matchOperator: "all" as const,
	onMatchOperatorChange: noop,
	onStartAddClause: noop,
	onStartEditClause: noop,
	onRemoveClause: noop,
	onChangeDraft: noop,
	onSubmitClause: noop,
	onCancelClause: noop,
	sample: { messages, label: "What this matches" },
};

const folderProps = {
	mailboxes: [
		{ id: "mbx-archive", label: "Archive" },
		{ id: "mbx-travel", label: "Travel" },
		{ id: "mbx-inbox", label: "Inbox", isCurrent: true },
	],
	mailboxId: "mbx-travel",
	onSelect: noop,
	onCreateFolder: () => Promise.resolve({ id: "mbx-new", label: "Hotels" }),
};

const ruleProps = {
	onScopeChange: noop,
	until: "",
	onUntilChange: noop,
	clauses,
};

const nameProps = { name: "Travel confirmations", onNameChange: noop };

const reviewProps = {
	verb: "move" as const,
	mode: "selected" as const,
	selectedCount: 2,
	clauses,
	matchOperator: "all" as const,
	folder: "Travel",
	sample,
};

const runProps = {
	state: "backApplyComplete" as const,
	verb: "move" as const,
	matched: 2,
	applied: 2,
	failures: [],
	onRetry: noop,
	onDismiss: noop,
};

const wizardProps = (overrides: Partial<SelectionWizardProps> = {}) => ({
	verb: "move" as const,
	steps: stepsFor({ verb: "move", mode: "selected" }),
	step: "match" as StepId,
	onBack: noop,
	onExit: noop,
	onContinue: noop,
	onCommit: noop,
	match: matchProps,
	properties: propertiesProps,
	folder: folderProps,
	rule: ruleProps,
	name: nameProps,
	review: reviewProps,
	run: runProps,
	...overrides,
});

describe("SelectionSample", () => {
	it("says nothing matches rather than rendering a bare empty state", () => {
		const html = renderToString(
			createElement(SelectionSample, {
				messages: [],
				label: "What this matches",
				emptyReason: "noMatch",
			}),
		);
		assert.match(html, /Nothing matches this yet/);
	});

	it("says the mail is not indexed yet, the other reason for no rows", () => {
		const html = renderToString(
			createElement(SelectionSample, {
				messages: [],
				label: "What this matches",
				emptyReason: "notIndexed",
			}),
		);
		assert.match(html, /isn&#x27;t indexed yet/);
		assert.doesNotMatch(html, /Nothing matches this yet/);
	});

	it("still explains itself when no reason was given", () => {
		const html = renderToString(
			createElement(SelectionSample, { messages: [], label: "Sample" }),
		);
		assert.match(html, /Nothing matches this yet/);
	});

	it("says the total is unknown when the match has not run", () => {
		const html = renderToString(
			createElement(SelectionSample, { messages, label: "First matches" }),
		);
		assert.match(html, /not known until the run finishes/);
	});

	it("counts the rest once the server's count has settled", () => {
		const html = renderToString(
			createElement(SelectionSample, {
				messages,
				preview: counted(9),
				label: "What this covers",
			}),
		);
		assert.match(text(html), /and 7 more/);
		assert.doesNotMatch(html, /not known until the run finishes/);
	});

	it("says a count that is still moving is still moving", () => {
		const loading = renderToString(
			createElement(SelectionSample, {
				messages,
				preview: { status: "loading" },
				label: "What this covers",
			}),
		);
		assert.match(loading, /Counting matches/);

		const stale = renderToString(
			createElement(SelectionSample, {
				messages,
				preview: { status: "ready", count: 9, stale: true },
				label: "What this covers",
			}),
		);
		assert.match(text(stale), /recounting/);
		assert.doesNotMatch(text(stale), /and 7 more/);
	});
});

describe("MatchStepBody", () => {
	it("offers the three doors with the ticked count on them", () => {
		const html = renderToString(createElement(MatchStepBody, matchProps));
		assert.match(html, /These 2 messages/);
		assert.match(html, /Similar to these 2/);
		assert.match(html, /Its properties/);
	});

	it("leaves the similar door pressable and dimmed when it cannot run", () => {
		const html = renderToString(
			createElement(MatchStepBody, {
				...matchProps,
				semanticUnavailable: true,
				semanticFallbackTaken: true,
			}),
		);
		assert.match(html, /opacity-55/);
		assert.doesNotMatch(html, /disabled=""/);
		assert.match(html, /matching on the\s+senders instead/);
	});
});

describe("PropertiesStepBody", () => {
	it("renders the rule as the shipped chips, with the join between them", () => {
		const html = renderToString(
			createElement(PropertiesStepBody, propertiesProps),
		);
		assert.match(html, /noreply@booking\.com/);
		assert.match(html, /Remove From clause/);
		assert.match(html, /from sender/);
		assert.match(html, /Add clause/);
		assert.match(html, /Match operator/);
	});

	it("opens the shipped clause editor on the clause being amended", () => {
		const html = renderToString(
			createElement(PropertiesStepBody, {
				...propertiesProps,
				clauseEdit: {
					mode: "edit",
					clauseId: "c1",
					draft: { field: "From", value: "noreply@booking.com" },
				},
				clauseSuggestions: [{ value: "noreply@ryanair.com" }],
			}),
		);
		assert.match(html, /Clause field/);
		assert.match(html, /Clause value/);
		assert.doesNotMatch(html, /Add clause/);
	});

	it("carries the conversion notice when a search opened it", () => {
		const html = renderToString(
			createElement(PropertiesStepBody, {
				...propertiesProps,
				conversionNotice: {
					scopedOutFolder: "Archive",
					droppedFacets: ["Unread"],
					droppedSemantic: true,
				},
				semanticFallbackTaken: true,
			}),
		);
		assert.match(html, /From your search/);
		assert.match(html, /limited to Archive/);
		assert.match(html, /These are the senders/);
	});

	it("offers no combine control for a single clause", () => {
		const html = renderToString(
			createElement(PropertiesStepBody, {
				...propertiesProps,
				clauses: [clauses[0]],
			}),
		);
		assert.doesNotMatch(html, /Match operator/);
	});
});

describe("FolderStepBody", () => {
	it("offers the destinations the app ordered, and names the one chosen", () => {
		const html = renderToString(createElement(FolderStepBody, folderProps));
		assert.ok(html.indexOf(">Archive<") < html.indexOf(">Travel<"));
		assert.match(text(html), /Moving to Travel\./);
		assert.match(html, /Move to Archive/);
	});

	it("marks the folder the mail is already in rather than offering it", () => {
		const html = renderToString(createElement(FolderStepBody, folderProps));
		assert.match(html, /Inbox \(current folder\)/);
	});

	it("says how to make a folder when none is chosen yet", () => {
		const html = renderToString(
			createElement(FolderStepBody, { ...folderProps, mailboxId: undefined }),
		);
		assert.match(text(html), /type a name that doesn&#x27;t exist yet/);
	});
});

describe("RuleStepBody", () => {
	it("offers the three scopes", () => {
		const html = renderToString(
			createElement(RuleStepBody, { ...ruleProps, scope: "once" }),
		);
		assert.match(html, /Just once/);
		assert.match(html, /Keep doing this/);
		assert.match(html, /Until a date/);
	});

	it("says a one-time apply cannot read message bodies, where the scope is chosen", () => {
		const html = renderToString(
			createElement(RuleStepBody, {
				...ruleProps,
				clauses: [{ id: "c1", field: "HasWords", value: "boarding pass" }],
			}),
		);
		assert.match(html, /can&#x27;t read message bodies/);
	});

	it("asks for the stop date on the step that offered the scope", () => {
		const html = renderToString(
			createElement(RuleStepBody, {
				...ruleProps,
				scope: "until",
				until: "2026-09-01",
			}),
		);
		assert.match(html, /Stops on/);
		assert.match(html, /2026-09-01/);
	});
});

describe("NameStepBody", () => {
	it("prefills the suggested name and offers to clear it", () => {
		const html = renderToString(createElement(NameStepBody, nameProps));
		assert.match(html, /Travel confirmations/);
		assert.match(html, /Clear name/);
	});

	it("offers no clear control when the field is empty", () => {
		const html = renderToString(
			createElement(NameStepBody, { ...nameProps, name: "" }),
		);
		assert.doesNotMatch(html, /Clear name/);
	});
});

describe("ReviewStepBody", () => {
	it("states the whole thing as one sentence, then as a list, then the sample", () => {
		const html = renderToString(createElement(ReviewStepBody, reviewProps));
		assert.match(html, /2 messages/);
		assert.match(html, /to Travel/);
		assert.match(html, /Destination/);
		assert.match(html, /Booking confirmation/);
	});

	it("warns that a widened match covers messages not shown in the list", () => {
		const html = renderToString(
			createElement(ReviewStepBody, {
				...reviewProps,
				mode: "similar",
				sample: { messages, label: "A sample of what matches" },
			}),
		);
		assert.match(html, /covers messages not shown in the list/);
		assert.match(html, /not known until the run finishes/);
	});

	it("names the rule and its stop date once the scope persists", () => {
		const html = renderToString(
			createElement(ReviewStepBody, {
				...reviewProps,
				verb: "organize",
				scope: "until",
				until: "2026-09-01",
				ruleName: "Travel confirmations",
			}),
		);
		assert.match(html, /save a rule/);
		assert.match(html, /until 2026-09-01/);
		assert.match(html, /Travel confirmations/);
	});
});

describe("RunStepBody", () => {
	it("shows the pass over existing mail running, with progress", () => {
		const html = renderToString(
			createElement(RunStepBody, {
				...runProps,
				state: "backApplyRunning",
				scope: "standing",
				applied: 0,
			}),
		);
		assert.match(html, /Moving the mail already in your mailbox/);
		assert.match(html, /role="progressbar"/);
	});

	it("names every message the mail server rejected, and keeps the rule", () => {
		const html = renderToString(
			createElement(RunStepBody, {
				...runProps,
				state: "backApplyFailed",
				scope: "standing",
				matched: 4,
				applied: 2,
				failures: messages,
			}),
		);
		assert.match(html, /Not moved/);
		assert.match(html, /Booking\.com/);
		assert.match(html, /Server rejected/);
		assert.match(html, /The rule itself is saved/);
	});

	it("ends a one-off run on its own count", () => {
		const html = renderToString(
			createElement(RunStepBody, { ...runProps, scope: "once" }),
		);
		assert.match(html, /Moved 2/);
	});

	it("says a create that failed changed nothing", () => {
		const html = renderToString(
			createElement(RunStepBody, {
				...runProps,
				state: "commitFailed",
				scope: "standing",
			}),
		);
		assert.match(html, /Couldn&#x27;t save the rule/);
		assert.match(html, /Nothing has changed\./);
	});

	it("says a filter saved with nothing to back-apply is live", () => {
		const html = renderToString(
			createElement(RunStepBody, {
				...runProps,
				state: "filterSaved",
				scope: "standing",
			}),
		);
		assert.match(html, /Filter saved/);
		assert.doesNotMatch(html, /role="progressbar"/);
	});
});

describe("RunFooter", () => {
	it("offers a retry for the messages that failed", () => {
		const html = renderToString(
			createElement(RunFooter, {
				...runProps,
				state: "backApplyFailed",
				failures: messages,
			}),
		);
		assert.match(html, /Retry 2/);
		assert.match(html, /Close/);
	});

	it("offers the pass again when it never started", () => {
		const html = renderToString(
			createElement(RunFooter, {
				...runProps,
				state: "backApplyStartFailed",
				scope: "standing",
			}),
		);
		assert.match(html, /Run it over existing mail/);
		assert.match(html, /Not now/);
	});

	it("offers only a way out once there is nothing outstanding", () => {
		const html = renderToString(createElement(RunFooter, runProps));
		assert.match(html, /Done/);
		assert.doesNotMatch(html, /Retry/);
	});

	it("lets the user leave while the job is still in flight", () => {
		const html = renderToString(
			createElement(RunFooter, { ...runProps, state: "saving" }),
		);
		assert.match(html, /Close/);
	});
});

describe("SelectionWizard", () => {
	it("renders the header, the rail and the footer around every step", () => {
		for (const step of stepsFor({
			verb: "organize",
			mode: "properties",
			scope: "standing",
		})) {
			const html = renderToString(
				createElement(
					SelectionWizard,
					wizardProps({
						verb: "organize",
						steps: stepsFor({
							verb: "organize",
							mode: "properties",
							scope: "standing",
						}),
						step,
						review: { ...reviewProps, verb: "organize", scope: "standing" },
					}),
				),
			);
			assert.match(html, /aria-label="Back"/, step);
			assert.match(html, /aria-label="Cancel"/, step);
			assert.match(html, /aria-label="Progress"/, step);
		}
	});

	it("counts the step out of the list the rail is rendering", () => {
		const steps = stepsFor({ verb: "move", mode: "properties" });
		const html = renderToString(
			createElement(SelectionWizard, wizardProps({ steps, step: "folder" })),
		);
		assert.match(text(html), /Step 3 of 5 · Folder/);
	});

	it("renders the header, the rail and the body from one resolved step", () => {
		const steps = stepsFor({ verb: "organize", mode: "selected" });
		const html = renderToString(
			createElement(
				SelectionWizard,
				wizardProps({ verb: "organize", steps, step: "properties" }),
			),
		);
		assert.match(text(html), /Step 1 of 4 · Apply to/);
		assert.match(html, /What should this apply to\?/);
		assert.match(html, /These 2 messages/);
		assert.doesNotMatch(html, /Match properties/);
		assert.doesNotMatch(html, /Add clause/);
	});

	it("leaves the wizard on Back from the opening step and from the run", () => {
		const steps = stepsFor({ verb: "move", mode: "selected" });
		let backs = 0;
		let exits = 0;
		const handlers = {
			onBack: () => {
				backs += 1;
			},
			onExit: () => {
				exits += 1;
			},
		};
		const pressBack = (step: StepId) => {
			const screen = SelectionWizard(wizardProps({ steps, step, ...handlers }));
			(screen.props as WizardScreenProps).onBack();
		};

		pressBack("match");
		pressBack("run");
		assert.deepEqual({ backs, exits }, { backs: 0, exits: 2 });

		pressBack("folder");
		assert.deepEqual({ backs, exits }, { backs: 1, exits: 2 });
	});

	it("flips the header from the verb to Done once the job has ended", () => {
		const steps = stepsFor({ verb: "move", mode: "selected" });
		const running = renderToString(
			createElement(
				SelectionWizard,
				wizardProps({
					steps,
					step: "run",
					run: { ...runProps, state: "backApplyRunning" },
				}),
			),
		);
		assert.match(running, /<h1[^>]*>Move<\/h1>/);

		const ended = renderToString(
			createElement(SelectionWizard, wizardProps({ steps, step: "run" })),
		);
		assert.match(ended, /<h1[^>]*>Done<\/h1>/);
	});

	it("keeps a blocked Continue pressable and dimmed, and says what is missing", () => {
		const html = renderToString(
			createElement(
				SelectionWizard,
				wizardProps({
					step: "properties",
					blockedReason: "Add a property to match on.",
					nudged: true,
				}),
			),
		);
		assert.match(html, /Add a property to match on\./);
		assert.match(html, /aria-disabled="true"/);
		assert.doesNotMatch(html, /<button[^>]*disabled=""/);
	});

	it("holds the blocked reason back until Continue is pressed", () => {
		const html = renderToString(
			createElement(
				SelectionWizard,
				wizardProps({
					step: "properties",
					blockedReason: "Add a property to match on.",
				}),
			),
		);
		assert.doesNotMatch(html, /Add a property to match on\./);
		assert.match(html, /aria-disabled="true"/);
	});

	it("commits under the scope's own label, in the verb's own tone", () => {
		const html = renderToString(
			createElement(
				SelectionWizard,
				wizardProps({
					verb: "delete",
					step: "review",
					review: { ...reviewProps, verb: "delete", scope: undefined },
				}),
			),
		);
		assert.match(html, /Delete/);
		assert.match(html, /bg-danger/);
	});

	it("uses the scope's commit label once a rule is being saved", () => {
		const html = renderToString(
			createElement(
				SelectionWizard,
				wizardProps({
					verb: "organize",
					steps: stepsFor({
						verb: "organize",
						mode: "selected",
						scope: "standing",
					}),
					step: "review",
					review: { ...reviewProps, verb: "organize", scope: "standing" },
				}),
			),
		);
		assert.match(html, /Save rule/);
	});

	it("fails loudly rather than rendering a step with no answers", () => {
		assert.throws(
			() =>
				renderToString(
					createElement(
						SelectionWizard,
						wizardProps({ step: "folder", folder: undefined }),
					),
				),
			/Folder step was rendered without its answers/,
		);
	});
});
