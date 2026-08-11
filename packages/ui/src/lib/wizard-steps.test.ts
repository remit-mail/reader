import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuleClause, RuleScope } from "../components/filter-rule.js";
import {
	commitBlockedReason,
	ruleBlockedCopy,
} from "../components/filter-rule.js";
import {
	backExits,
	clauseSentence,
	clauseWords,
	crossAccountMatchReason,
	ESCALATED_MATCH_HINT,
	ESCALATED_REVIEW_WARNING,
	escalatedMatchLabel,
	type MatchCount,
	type MatchMode,
	matchDoorHint,
	matchDoorLabel,
	matchDoorsFor,
	matchPhrase,
	matchSummary,
	type RunState,
	runCopy,
	type StepId,
	sampleEmptyCopy,
	stepBlockedReason,
	stepIndex,
	stepLabel,
	stepsFor,
	unreadableDraftClauses,
	type Verb,
	verbCopy,
	type WizardDraft,
} from "./wizard-steps.js";

const VERBS: Verb[] = ["delete", "move", "junk", "markRead", "organize"];
const MODES: MatchMode[] = ["selected", "similar", "properties", "escalated"];
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

	it("gives Organize a destination and a scope step, and a naming step only where the scope persists", () => {
		assert.deepEqual(stepsFor({ verb: "organize", mode: "selected" }), [
			"match",
			"folder",
			"rule",
			"review",
			"run",
		]);
		assert.deepEqual(
			stepsFor({ verb: "organize", mode: "selected", scope: "once" }),
			["match", "folder", "rule", "review", "run"],
		);
		assert.deepEqual(
			stepsFor({ verb: "organize", mode: "similar", scope: "standing" }),
			["match", "folder", "rule", "name", "review", "run"],
		);
		assert.deepEqual(
			stepsFor({ verb: "organize", mode: "properties", scope: "until" }),
			["match", "properties", "folder", "rule", "name", "review", "run"],
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
			["properties", "folder", "rule", "name", "review", "run"],
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

	it("keeps the user on the step they were looking at when the list shortens", () => {
		const standing = stepsFor({
			verb: "organize",
			mode: "selected",
			scope: "standing",
		});
		assert.deepEqual(standing, [
			"match",
			"folder",
			"rule",
			"name",
			"review",
			"run",
		]);

		const once = stepsFor({
			verb: "organize",
			mode: "selected",
			scope: "once",
		});
		assert.deepEqual(once, ["match", "folder", "rule", "review", "run"]);

		// The user is on Review when they go back and change the scope to once.
		// Held by number, index 3 lands them on Run — the action taken without the
		// review screen they were standing on. Held by id, Review is still Review.
		assert.equal(once[standing.indexOf("review")], "run");
		assert.equal(once[stepIndex(once, "review")], "review");

		// And the step the answer dropped resolves to the opening step rather than
		// to whatever now sits at its old number.
		assert.equal(once[standing.indexOf("name")], "review");
		assert.equal(once[stepIndex(once, "name")], "match");

		// A step both lists hold stays the same step, whichever way the answer went.
		for (const held of ["match", "rule", "review", "run"] as StepId[]) {
			assert.equal(once[stepIndex(once, held)], held);
			assert.equal(standing[stepIndex(standing, held)], held);
		}
	});

	it("keeps the properties step from stranding when the door changes", () => {
		const withEditor = stepsFor({ verb: "move", mode: "properties" });
		const withoutEditor = stepsFor({ verb: "move", mode: "selected" });
		assert.deepEqual(withEditor, [
			"match",
			"properties",
			"folder",
			"review",
			"run",
		]);
		assert.deepEqual(withoutEditor, ["match", "folder", "review", "run"]);

		const heldByNumber = withEditor.indexOf("properties");
		assert.equal(withoutEditor[heldByNumber], "folder");
		assert.equal(
			withoutEditor[stepIndex(withoutEditor, "properties")],
			"match",
		);
	});

	it("resolves a step the answers dropped back to the opening step", () => {
		const shortened = stepsFor({ verb: "organize", mode: "selected" });
		assert.equal(shortened.includes("properties"), false);
		assert.equal(stepIndex(shortened, "properties"), 0);
		assert.equal(stepIndex(shortened, "rule"), 2);
	});
});

describe("backExits", () => {
	it("leaves the wizard from the opening step, which has nothing behind it", () => {
		const steps = stepsFor({ verb: "move", mode: "selected" });
		assert.equal(backExits(steps, "match"), true);
		assert.equal(backExits(steps, "folder"), false);
		assert.equal(backExits(steps, "review"), false);
	});

	it("leaves the wizard from the run, whose action has already happened", () => {
		const steps = stepsFor({ verb: "move", mode: "selected" });
		assert.equal(backExits(steps, "run"), true);
	});

	it("leaves the wizard from the properties step a search opened on", () => {
		const steps = stepsFor({
			verb: "organize",
			mode: "properties",
			fromSearch: true,
		});
		assert.equal(backExits(steps, "properties"), true);
		assert.equal(backExits(steps, "rule"), false);
	});
});

const UNCOUNTED: MatchCount = { status: "uncounted" };

describe("stepBlockedReason", () => {
	const draft = (over: Partial<WizardDraft> = {}): WizardDraft => ({
		clauses: [],
		matchOperator: "all",
		...over,
	});

	it("names what the properties step is missing, in the rule editor's words", () => {
		assert.equal(
			stepBlockedReason("properties", draft(), UNCOUNTED),
			ruleBlockedCopy.noMatch,
		);
		assert.equal(
			stepBlockedReason(
				"properties",
				draft({ clauses: [clause("From", " ")] }),
				UNCOUNTED,
			),
			"Fill in every property, or take the empty one off.",
		);
		assert.equal(
			stepBlockedReason(
				"properties",
				draft({ clauses: [clause("From", "a@b.example")] }),
				UNCOUNTED,
			),
			undefined,
		);
	});

	it("names what the folder step is missing", () => {
		assert.equal(
			stepBlockedReason("folder", draft(), UNCOUNTED),
			"Pick a destination first.",
		);
		assert.equal(
			stepBlockedReason(
				"folder",
				draft({ moveMailboxId: "mbx-travel" }),
				UNCOUNTED,
			),
			undefined,
		);
	});

	it("says a one-time apply cannot read message bodies, where the scope is chosen", () => {
		const clauses = [clause("HasWords", "boarding pass")];
		assert.equal(
			stepBlockedReason("rule", draft({ clauses, scope: "once" }), UNCOUNTED),
			ruleBlockedCopy.bodyTextOnce,
		);
		assert.equal(
			stepBlockedReason(
				"rule",
				draft({ clauses, scope: "standing" }),
				UNCOUNTED,
			),
			undefined,
		);
	});

	it("names what the scope step is missing", () => {
		assert.equal(
			stepBlockedReason("rule", draft(), UNCOUNTED),
			"Choose one of the three first.",
		);
		assert.equal(
			stepBlockedReason("rule", draft({ scope: "until" }), UNCOUNTED),
			ruleBlockedCopy.noUntilDate,
		);
		assert.equal(
			stepBlockedReason(
				"rule",
				draft({ scope: "until", until: "2026-09-01" }),
				UNCOUNTED,
			),
			undefined,
		);
		assert.equal(
			stepBlockedReason("rule", draft({ scope: "once" }), UNCOUNTED),
			undefined,
		);
	});

	it("names what the naming step is missing", () => {
		assert.equal(
			stepBlockedReason("name", draft(), UNCOUNTED),
			ruleBlockedCopy.unnamed,
		);
		assert.equal(
			stepBlockedReason("name", draft({ name: "  " }), UNCOUNTED),
			ruleBlockedCopy.unnamed,
		);
		assert.equal(
			stepBlockedReason("name", draft({ name: "Receipts" }), UNCOUNTED),
			undefined,
		);
	});

	it("holds the commit until the server's count has settled", () => {
		assert.equal(
			stepBlockedReason("review", draft(), { status: "loading" }),
			ruleBlockedCopy.counting,
		);
		assert.equal(
			stepBlockedReason("review", draft(), {
				status: "ready",
				count: 4,
				stale: true,
			}),
			ruleBlockedCopy.recounting,
		);
		assert.equal(
			stepBlockedReason("review", draft(), { status: "ready", count: 4 }),
			undefined,
		);
	});

	it("refuses to commit a match that reaches nothing", () => {
		// A settled zero is a whole answer: committing it would report a bulk
		// action over no mail. The reload path lands here too — the step comes
		// back in the URL and the ticked rows do not come back with it.
		const reason = stepBlockedReason("review", draft(), {
			status: "ready",
			count: 0,
		});
		assert.ok(reason);
		assert.match(reason, /nothing to do/);
		// A zero that is still being recounted is not that answer yet.
		assert.equal(
			stepBlockedReason("review", draft(), {
				status: "ready",
				count: 0,
				stale: true,
			}),
			ruleBlockedCopy.recounting,
		);
	});

	it("waits on no count where a widened door never had one", () => {
		assert.equal(stepBlockedReason("review", draft(), UNCOUNTED), undefined);
	});

	it("lets the semantic widen carry a clause the literal matcher cannot read", () => {
		// The clause was added on the property door, then the user went back and
		// took "Similar to these". The widen is the matcher now and it reads
		// bodies, so a one-off apply is fine — and the property step is not even in
		// this step list, so a block here would name a clause on no reachable
		// screen.
		const clauses = [clause("HasWords", "boarding pass")];
		const similar = draft({
			clauses,
			scope: "once",
			widen: { anchorCount: 3 },
		});
		assert.equal(
			stepsFor({ verb: "organize", mode: "similar", scope: "once" }).includes(
				"properties",
			),
			false,
		);
		assert.deepEqual(unreadableDraftClauses(similar), []);
		assert.equal(stepBlockedReason("rule", similar, UNCOUNTED), undefined);
	});

	it("holds a one-off apply again once the widen cannot be evaluated", () => {
		const blocked = draft({
			clauses: [clause("HasWords", "boarding pass")],
			scope: "once",
			widen: { anchorCount: 3, inactive: true },
		});
		assert.equal(
			stepBlockedReason("rule", blocked, UNCOUNTED),
			ruleBlockedCopy.bodyTextOnce,
		);
	});

	it("blocks nothing on the steps that ask nothing", () => {
		for (const step of ["match", "run"] as StepId[]) {
			assert.equal(stepBlockedReason(step, draft(), UNCOUNTED), undefined);
		}
	});

	it("says the same thing the rule editor says about the same gap", () => {
		const rule = {
			clauses: [],
			matchOperator: "all" as const,
			scope: "standing" as const,
		};
		assert.equal(
			commitBlockedReason(rule, { status: "ready", count: 0 }),
			stepBlockedReason("properties", draft(), UNCOUNTED),
		);
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
			"backApplyRestartFailed",
			"statusUnknown",
			"filterSaved",
			"runStopped",
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

	it("separates a run that stopped from a pass the server rejected", () => {
		// The bulk endpoints accept every id in a call that returns, so the only
		// failure the chunked runner can observe is a call that threw — and
		// everything after it was never sent. Saying the mail server rejected
		// those states a cause that did not happen.
		const stopped = outcome("runStopped", "once");
		assert.equal(stopped.title, "Stopped after 10");
		assert.match(stopped.detail, /nothing was sent for them/);
		assert.doesNotMatch(stopped.detail, /rejected/);
		assert.equal(stopped.retryLabel, "Retry 2");
		assert.equal(stopped.showProgress, true);

		// The back-apply pass is run by the server, which reports what it could
		// not apply — a rejection, and worded as one.
		assert.match(outcome("backApplyFailed", "once").detail, /rejected/);
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

	it("keeps the counts of the pass that ran when its retry could not be started", () => {
		// #552: the retry is a second pass over the same mail, so a retry that
		// failed leaves the first pass's ending exactly where it was.
		const once = outcome("backApplyRestartFailed", "once");
		assert.equal(once.title, "The retry didn't start");
		assert.match(once.detail, /10 of 12 moved/);
		assert.match(once.detail, /rejected 2/);
		assert.match(once.detail, /Check your connection/);
		assert.doesNotMatch(once.detail, /Nothing has changed/);
		assert.equal(once.tone, "warning");
		assert.equal(once.retryLabel, "Retry 2");
		assert.equal(once.showProgress, true);

		const standing = outcome("backApplyRestartFailed", "standing");
		assert.match(standing.title, /Rule saved/);
		assert.doesNotMatch(standing.detail, /never started/);
		assert.match(standing.detail, /keeps working on new mail/);
		assert.equal(standing.retryLabel, "Retry 2");
	});

	it("keeps a run that is going when its progress could not be read", () => {
		// A poll that failed says nothing about the job behind it (#526), so the
		// screen never claims the action never started, and the way out of it is a
		// second look rather than a second run.
		const once = outcome("statusUnknown", "once");
		assert.equal(once.title, "Moving — progress unknown");
		assert.match(once.detail, /carries on either way/);
		assert.doesNotMatch(once.detail, /Nothing has changed/);
		assert.equal(once.tone, "warning");
		assert.equal(once.retryLabel, "Check again");
		assert.equal(once.screenTitle, "Move");

		const standing = outcome("statusUnknown", "standing");
		assert.match(standing.title, /Rule saved/);
		assert.doesNotMatch(standing.detail, /never started/);
		assert.match(standing.detail, /keeps working on new mail/);
		assert.equal(standing.retryLabel, "Check again");
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

	// #522: a commit that resolved no destination fails the same way every time
	// it is sent. Stating "Nothing has changed" over a Try again leaves the user
	// pressing a control that can never work, with nothing naming the setting
	// that would.
	it("carries the reason a commit could not start, in place of a retry", () => {
		const reason =
			"This account has no Junk folder appointed, so there is nowhere to file these. Appoint one under Settings › Folders.";
		const blocked = runCopy({
			state: "commitFailed",
			verb: "junk",
			scope: "once",
			matched: 0,
			applied: 0,
			failed: 0,
			failureReason: reason,
		});

		assert.equal(blocked.detail, reason);
		assert.doesNotMatch(blocked.detail, /Nothing has changed/);
		assert.equal(blocked.retryLabel, undefined);
		assert.equal(blocked.dismissLabel, "Close");
		assert.equal(blocked.tone, "danger");
		assert.match(blocked.title, /^Couldn't start/);
	});

	it("shows progress only while a pass over existing mail is under way or finished", () => {
		assert.equal(outcome("saving", "standing").showProgress, false);
		assert.equal(outcome("backApplyRunning", "standing").showProgress, true);
		assert.equal(outcome("backApplyComplete", "once").showProgress, true);
		assert.equal(outcome("backApplyFailed", "once").showProgress, true);
		// The last counts read are still the last counts read.
		assert.equal(outcome("statusUnknown", "once").showProgress, true);
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

	it("heads the screen Done only once something finished", () => {
		assert.equal(outcome("saving", "standing").screenTitle, "Move");
		assert.equal(outcome("backApplyRunning", "standing").screenTitle, "Move");
		// Nothing was created, so nothing was done.
		assert.equal(outcome("commitFailed", "standing").screenTitle, "Move");

		for (const state of [
			"backApplyComplete",
			"backApplyFailed",
			"backApplyStartFailed",
			"filterSaved",
		] as RunState[]) {
			assert.equal(outcome(state, "standing").screenTitle, "Done", state);
		}
	});
});

describe("sample and door vocabulary", () => {
	it("explains an empty sample rather than leaving it bare", () => {
		assert.match(sampleEmptyCopy("noMatch"), /Nothing matches/);
		assert.match(sampleEmptyCopy("notIndexed"), /isn't indexed yet/);
	});

	it("states what an escalated predicate covers instead of a door", () => {
		assert.equal(
			escalatedMatchLabel('matching "npm"'),
			'Every message matching "npm"',
		);
		assert.match(ESCALATED_MATCH_HINT, /nothing to widen/);
		assert.match(ESCALATED_REVIEW_WARNING, /by the time it runs/);
	});

	it("withholds the widened doors where there is no single account", () => {
		assert.deepEqual(
			[...matchDoorsFor("acc-personal")],
			["selected", "similar", "properties"],
		);
		assert.deepEqual([...matchDoorsFor(undefined)], ["selected"]);
		assert.match(crossAccountMatchReason, /within one account/);
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

	it("summarises an escalated predicate by what it covers", () => {
		assert.equal(
			matchSummary({
				mode: "escalated",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
				escalatedScope: 'matching "npm"',
			}),
			'Every message matching "npm"',
		);
		assert.equal(
			matchSummary({
				mode: "escalated",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
			}),
			"Every message the list is showing",
		);
	});

	it("phrases an escalated predicate with the count the server gave it", () => {
		assert.equal(
			matchPhrase({
				mode: "escalated",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
				escalatedScope: 'matching "npm"',
				escalatedCount: 3412,
			}),
			'all 3,412 messages matching "npm"',
		);
	});

	it("claims no number while the count is still being taken", () => {
		assert.equal(
			matchPhrase({
				mode: "escalated",
				selectedCount: 4,
				clauses,
				matchOperator: "all",
				escalatedScope: 'matching "npm"',
			}),
			'every message matching "npm"',
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
