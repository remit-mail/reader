import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuleClause, RuleScope } from "../components/filter-rule.js";
import {
	clauseSentence,
	clauseWords,
	dominantSender,
	folderDepth,
	folderLeaf,
	folderParent,
	type MatchMode,
	matchDoorHint,
	matchDoorLabel,
	matchPhrase,
	matchSummary,
	orderFolders,
	type RunState,
	runCopy,
	type StepId,
	sampleEmptyCopy,
	stepBlockedReason,
	stepIndex,
	stepLabel,
	stepsFor,
	suggestRuleName,
	type Verb,
	verbCopy,
} from "./wizard-steps.js";

const VERBS: Verb[] = ["delete", "move", "junk", "markRead", "organize"];
const MODES: MatchMode[] = ["selected", "similar", "properties"];
const SCOPES: (RuleScope | undefined)[] = [
	undefined,
	"once",
	"standing",
	"until",
];

const clause = (
	field: RuleClause["field"],
	value: string,
	id = field,
): RuleClause => ({ id, field, value });

describe("stepsFor — the step ids for every verb × match mode × scope", () => {
	it("gives the ticked door an opening step and no editor", () => {
		assert.deepEqual(stepsFor({ verb: "delete", mode: "selected" }), [
			"match",
			"review",
			"run",
		]);
		assert.deepEqual(stepsFor({ verb: "junk", mode: "similar" }), [
			"match",
			"review",
			"run",
		]);
		assert.deepEqual(stepsFor({ verb: "markRead", mode: "properties" }), [
			"match",
			"properties",
			"review",
			"run",
		]);
	});

	it("gives Move a destination step", () => {
		assert.deepEqual(stepsFor({ verb: "move", mode: "selected" }), [
			"match",
			"folder",
			"review",
			"run",
		]);
		assert.deepEqual(stepsFor({ verb: "move", mode: "properties" }), [
			"match",
			"properties",
			"folder",
			"review",
			"run",
		]);
	});

	it("gives Organize a scope step, and a naming step only where the scope persists", () => {
		assert.deepEqual(stepsFor({ verb: "organize", mode: "selected" }), [
			"match",
			"rule",
			"review",
			"run",
		]);
		assert.deepEqual(
			stepsFor({ verb: "organize", mode: "selected", scope: "once" }),
			["match", "rule", "review", "run"],
		);
		assert.deepEqual(
			stepsFor({ verb: "organize", mode: "similar", scope: "standing" }),
			["match", "rule", "name", "review", "run"],
		);
		assert.deepEqual(
			stepsFor({ verb: "organize", mode: "properties", scope: "until" }),
			["match", "properties", "rule", "name", "review", "run"],
		);
	});

	it("drops the match step when a search is what opened the wizard", () => {
		assert.deepEqual(
			stepsFor({
				verb: "organize",
				mode: "properties",
				scope: "standing",
				fromSearch: true,
			}),
			["properties", "rule", "name", "review", "run"],
		);
		assert.deepEqual(
			stepsFor({ verb: "move", mode: "properties", fromSearch: true }),
			["properties", "folder", "review", "run"],
		);
	});

	it("always opens on a step and always ends on the run", () => {
		for (const verb of VERBS) {
			for (const mode of MODES) {
				for (const scope of SCOPES) {
					for (const fromSearch of [false, true]) {
						const steps = stepsFor({ verb, mode, scope, fromSearch });
						assert.ok(steps.length >= 3, `${verb}/${mode}/${scope}`);
						assert.equal(steps.at(-1), "run");
						assert.equal(steps.at(-2), "review");
						assert.equal(
							new Set(steps).size,
							steps.length,
							"no step appears twice",
						);
					}
				}
			}
		}
	});
});

describe("stepsFor — a branching answer only adds or drops a step after itself", () => {
	const positionOf = (steps: StepId[], step: StepId): number =>
		steps.indexOf(step);

	it("keeps the match step and everything before the answer in place", () => {
		for (const verb of VERBS) {
			for (const scope of SCOPES) {
				const lists = MODES.map((mode) => stepsFor({ verb, mode, scope }));
				for (const steps of lists) {
					assert.equal(positionOf(steps, "match"), 0);
				}
			}
		}
	});

	it("keeps the scope step in place across every scope answer", () => {
		for (const mode of MODES) {
			const lists = SCOPES.map((scope) =>
				stepsFor({ verb: "organize", mode, scope }),
			);
			const positions = new Set(
				lists.map((steps) => positionOf(steps, "rule")),
			);
			assert.equal(positions.size, 1, "the rule step never moves");
		}
	});

	it("never leaves a held step pointing past the end of a shortened list", () => {
		for (const verb of VERBS) {
			for (const mode of MODES) {
				for (const scope of SCOPES) {
					const before = stepsFor({ verb, mode, scope });
					for (const nextMode of MODES) {
						for (const nextScope of SCOPES) {
							const after = stepsFor({
								verb,
								mode: nextMode,
								scope: nextScope,
							});
							for (const held of before) {
								const index = stepIndex(after, held);
								assert.ok(
									index >= 0 && index < after.length,
									`${held} strands at ${index} in ${after.join(",")}`,
								);
							}
						}
					}
				}
			}
		}
	});

	it("resolves a step the answers dropped back to the opening step", () => {
		const shortened = stepsFor({ verb: "organize", mode: "selected" });
		assert.equal(shortened.includes("properties"), false);
		assert.equal(stepIndex(shortened, "properties"), 0);
		assert.equal(stepIndex(shortened, "rule"), 1);
	});
});

describe("stepBlockedReason", () => {
	it("names what the properties step is missing", () => {
		assert.equal(
			stepBlockedReason("properties", { clauses: [] }),
			"Add a property to match on.",
		);
		assert.equal(
			stepBlockedReason("properties", { clauses: [clause("From", "  ")] }),
			"Fill in every property, or take the empty one off.",
		);
		assert.equal(
			stepBlockedReason("properties", {
				clauses: [clause("From", "a@b.example")],
			}),
			undefined,
		);
	});

	it("names what the folder step is missing", () => {
		assert.equal(
			stepBlockedReason("folder", { clauses: [] }),
			"Pick a destination first.",
		);
		assert.equal(
			stepBlockedReason("folder", { clauses: [], folder: "Travel" }),
			undefined,
		);
	});

	it("says a one-time apply cannot read message bodies, where the scope is chosen", () => {
		const clauses = [clause("HasWords", "boarding pass")];
		assert.match(
			stepBlockedReason("rule", { clauses, scope: "once" }) ?? "",
			/can't read message bodies/,
		);
		assert.equal(
			stepBlockedReason("rule", { clauses, scope: "standing" }),
			undefined,
		);
	});

	it("names what the scope step is missing", () => {
		assert.equal(
			stepBlockedReason("rule", { clauses: [] }),
			"Choose one of the three first.",
		);
		assert.equal(
			stepBlockedReason("rule", { clauses: [], scope: "until" }),
			"Pick the date this rule should stop on.",
		);
		assert.equal(
			stepBlockedReason("rule", {
				clauses: [],
				scope: "until",
				until: "2026-09-01",
			}),
			undefined,
		);
		assert.equal(
			stepBlockedReason("rule", { clauses: [], scope: "once" }),
			undefined,
		);
	});

	it("names what the naming step is missing", () => {
		assert.equal(
			stepBlockedReason("name", { clauses: [] }),
			"Give the rule a name so you can find it later.",
		);
		assert.equal(
			stepBlockedReason("name", { clauses: [], ruleName: "  " }),
			"Give the rule a name so you can find it later.",
		);
		assert.equal(
			stepBlockedReason("name", { clauses: [], ruleName: "Receipts" }),
			undefined,
		);
	});

	it("blocks nothing on the steps that ask nothing", () => {
		for (const step of ["match", "review", "run"] as StepId[]) {
			assert.equal(stepBlockedReason(step, { clauses: [] }), undefined);
		}
	});
});

describe("runCopy", () => {
	const outcome = (state: RunState, scope?: RuleScope) =>
		runCopy({
			state,
			verb: "move",
			scope,
			matched: 12,
			applied: 10,
			failed: 2,
		});

	it("always offers a way out", () => {
		const states: RunState[] = [
			"saving",
			"backApplyRunning",
			"backApplyComplete",
			"backApplyFailed",
			"backApplyStartFailed",
			"filterSaved",
			"commitFailed",
		];
		for (const state of states) {
			for (const scope of SCOPES) {
				const copy = outcome(state, scope);
				assert.notEqual(copy.dismissLabel, "");
				assert.notEqual(copy.title, "");
				assert.notEqual(copy.detail, "");
			}
		}
	});

	it("says the rule survived a back-apply that did not", () => {
		const standing = outcome("backApplyFailed", "standing");
		assert.match(standing.title, /Rule saved/);
		assert.match(standing.detail, /The rule itself is saved/);
		assert.equal(standing.retryLabel, "Retry 2");
		assert.equal(standing.tone, "warning");

		const once = outcome("backApplyFailed", "once");
		assert.equal(once.title, "Not everything was moved");
		assert.doesNotMatch(once.detail, /rule/);
	});

	it("ends a one-off run on its own count and a saved rule on the rule", () => {
		assert.equal(outcome("backApplyComplete", "once").title, "Moved 10");
		assert.equal(
			outcome("backApplyComplete", "standing").title,
			"Rule saved and applied",
		);
		assert.match(
			outcome("backApplyComplete", "standing").detail,
			/New mail follows the rule as it arrives/,
		);
	});

	it("separates a back-apply that never started from one that failed", () => {
		const started = outcome("backApplyStartFailed", "standing");
		assert.equal(started.title, "Rule saved");
		assert.equal(started.retryLabel, "Run it over existing mail");
		assert.equal(started.showProgress, false);
	});

	it("says a filter saved with nothing to back-apply is still live", () => {
		const saved = outcome("filterSaved", "standing");
		assert.equal(saved.title, "Filter saved");
		assert.match(saved.detail, /New mail follows it as it arrives/);
		assert.equal(saved.retryLabel, undefined);
	});

	it("says nothing changed when the create itself failed", () => {
		const failed = outcome("commitFailed", "standing");
		assert.equal(failed.title, "Couldn't save the rule");
		assert.equal(failed.tone, "danger");
		assert.equal(failed.retryLabel, "Try again");
		assert.equal(outcome("commitFailed", "once").title, "Couldn't start move");
	});

	it("shows progress only while a pass over existing mail is under way or finished", () => {
		assert.equal(outcome("saving", "standing").showProgress, false);
		assert.equal(outcome("backApplyRunning", "standing").showProgress, true);
		assert.equal(outcome("backApplyComplete", "once").showProgress, true);
		assert.equal(outcome("backApplyFailed", "once").showProgress, true);
	});

	it("names the failure list in the verb's own past tense", () => {
		assert.equal(
			runCopy({
				state: "backApplyFailed",
				verb: "delete",
				matched: 3,
				applied: 1,
				failed: 2,
			}).failureListLabel,
			"Not deleted",
		);
	});

	it("counts the messages while a one-off run is in flight", () => {
		assert.equal(
			outcome("backApplyRunning", "once").title,
			"Moving 12 messages…",
		);
		assert.equal(outcome("saving", "once").title, "Applying…");
		assert.equal(outcome("saving", "standing").title, "Saving rule…");
	});
});

describe("sample and door vocabulary", () => {
	it("explains an empty sample rather than leaving it bare", () => {
		assert.match(sampleEmptyCopy("noMatch"), /Nothing matches/);
		assert.match(sampleEmptyCopy("notIndexed"), /isn't indexed yet/);
	});

	it("names each door and what it does", () => {
		assert.equal(matchDoorLabel("selected", 3), "These 3 messages");
		assert.equal(matchDoorLabel("similar", 3), "Similar to these 3");
		assert.equal(matchDoorLabel("properties", 3), "Its properties");
		assert.match(matchDoorHint("selected"), /ticked in the list/);
		assert.match(matchDoorHint("properties"), /No reading involved/);
	});

	it("labels every step", () => {
		assert.equal(stepLabel("match"), "Apply to");
		assert.equal(stepLabel("run"), "Run");
	});

	it("carries a present and past tense for every verb", () => {
		for (const verb of VERBS) {
			const copy = verbCopy(verb);
			assert.notEqual(copy.label, "");
			assert.notEqual(copy.present, "");
			assert.notEqual(copy.past, "");
		}
		assert.equal(verbCopy("delete").destructive, true);
		assert.equal(verbCopy("move").destructive, false);
	});
});

describe("the match as words", () => {
	const clauses = [
		clause("From", "noreply@booking.com"),
		clause("Subject", "trip"),
	];

	it("reads one clause as a field and a value", () => {
		assert.equal(clauseWords(clauses[0]), 'From "noreply@booking.com"');
	});

	it("joins clauses with the word the operator reads as", () => {
		assert.equal(
			clauseSentence(clauses, "all"),
			'From "noreply@booking.com" and Subject "trip"',
		);
		assert.equal(
			clauseSentence(clauses, "any"),
			'From "noreply@booking.com" or Subject "trip"',
		);
	});

	it("summarises each door for the review list", () => {
		assert.equal(
			matchSummary({
				mode: "selected",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
			}),
			"These 4 messages",
		);
		assert.equal(
			matchSummary({
				mode: "similar",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
			}),
			"Similar to these 4",
		);
		assert.equal(
			matchSummary({
				mode: "properties",
				selectedCount: 4,
				clauses,
				matchOperator: "any",
			}),
			'From "noreply@booking.com" or Subject "trip"',
		);
	});

	it("phrases each door for the review sentence", () => {
		assert.equal(
			matchPhrase({
				mode: "selected",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
			}),
			"4 messages",
		);
		assert.equal(
			matchPhrase({
				mode: "similar",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
			}),
			"mail similar to these 4",
		);
		assert.equal(
			matchPhrase({
				mode: "properties",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
			}),
			'every message where From "noreply@booking.com" and Subject "trip"',
		);
		assert.equal(
			matchPhrase({
				mode: "properties",
				selectedCount: 0,
				clauses: [],
				matchOperator: "all",
			}),
			"every message",
		);
	});
});

describe("folder paths", () => {
	it("splits a path into its parent and its leaf", () => {
		assert.equal(folderParent("Travel/2026"), "Travel");
		assert.equal(folderParent("Travel"), "");
		assert.equal(folderLeaf("Travel/2026"), "2026");
		assert.equal(folderDepth("Travel/2026/Q1"), 2);
	});

	it("puts every child straight after its parent", () => {
		assert.deepEqual(
			orderFolders(["Archive", "Travel/2026", "Travel", "Receipts"]),
			["Archive", "Travel", "Travel/2026", "Receipts"],
		);
	});

	it("renders a folder whose parent is missing as a root", () => {
		assert.deepEqual(orderFolders(["Archive", "Travel/2026"]), [
			"Archive",
			"Travel/2026",
		]);
	});
});

describe("rule naming", () => {
	it("takes the sender carrying most of the ticked rows", () => {
		assert.equal(
			dominantSender(["Booking.com", "Airbnb", "Booking.com"]),
			"Booking.com",
		);
		assert.equal(dominantSender([]), undefined);
	});

	it("suggests a name from what the wizard already knows", () => {
		assert.equal(
			suggestRuleName({ match: "Your receipt", folder: "Receipts" }),
			"Your receipt → Receipts",
		);
		assert.equal(
			suggestRuleName({ match: "Your receipt" }),
			"Mail matching Your receipt",
		);
		assert.equal(
			suggestRuleName({ sender: "Booking.com" }),
			"Mail from Booking.com",
		);
		assert.equal(suggestRuleName({ folder: "Travel" }), "Mail to Travel");
		assert.equal(suggestRuleName({}), "");
	});
});
