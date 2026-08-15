import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	backExits,
	type MatchMode,
	type RuleScope,
	type StepId,
	stepIndex,
	stepsFor,
	type Verb,
	type WizardAnswers,
} from "@remit/ui";
import {
	ownedHistoryEntries,
	wizardEntryFromParam,
	wizardEntryValue,
	wizardStepFromParam,
	wizardStepValue,
} from "./wizard-history.js";

const VERBS: readonly Verb[] = [
	"delete",
	"move",
	"junk",
	"markRead",
	"organize",
];
const MODES: readonly MatchMode[] = ["selected", "similar", "properties"];
const SCOPES: readonly (RuleScope | undefined)[] = [
	undefined,
	"once",
	"standing",
	"until",
];

const answerSets = (): WizardAnswers[] => {
	const sets: WizardAnswers[] = [];
	for (const verb of VERBS) {
		for (const mode of MODES) {
			for (const scope of SCOPES) {
				for (const fromSearch of [false, true]) {
					sets.push({ verb, mode, scope, fromSearch });
				}
			}
		}
	}
	return sets;
};

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "wizard-history.ts"), "utf8");

/** The steps up to and including the one an answer is given on. */
const prefixThrough = (steps: readonly StepId[], step: StepId): StepId[] =>
	steps.slice(0, steps.indexOf(step) + 1);

/**
 * The re-root runs inside a router, so the rule is enforced by reading the
 * source — as `../components/mail/MessageList.selection.test.ts` does for its
 * own component-level rules. What it pins is where the decision comes from: a
 * step the app itself pushed must never be re-rooted, or the push that opens
 * the wizard from a verb (#483) duplicates the entry underneath it and the
 * first back after Cancel appears to do nothing.
 */
describe("re-rooting a wizard that was loaded into", () => {
	it("decides from what the first render held, not from a flag", () => {
		assert.match(source, /useRef\(step !== undefined\)/);
		assert.match(
			source,
			/if \(!loadedHoldingStep\.current\) return;\s*\n\s*loadedHoldingStep\.current = false;/,
		);
	});

	// The root is the wizard-closed state, so it carries neither the step nor
	// the affordance that opened it; otherwise closing the wizard leaves the
	// entry marker behind in the address bar (#484).
	it("puts the wizard back on a root that names no entry", () => {
		assert.match(source, /wizard: undefined,\s*\n\s*wizardFrom: undefined,/);
		assert.match(
			source,
			/wizard: openingStep,\s*\n\s*wizardFrom: openingEntry,/,
		);
	});

	it("is never armed by a step the app pushed", () => {
		const goToStep = source.slice(source.indexOf("const goToStep"));
		assert.doesNotMatch(goToStep, /loadedHoldingStep/);
	});

	it("does not re-run when the step changes", () => {
		assert.doesNotMatch(source, /\}, \[step, openingStep, navigate\]\)/);
	});
});

describe("the wizard step in the URL", () => {
	it("round-trips every step the wizard can reach", () => {
		for (const answers of answerSets()) {
			for (const step of stepsFor(answers)) {
				assert.equal(wizardStepFromParam(step), step);
			}
		}
	});

	it("reads a value the wizard cannot be on as no step", () => {
		for (const value of [undefined, "", "Match", "step-1", 2, null, {}]) {
			assert.equal(wizardStepFromParam(value), undefined);
		}
	});

	it("never fails validation, so a mistyped link still lands on the mail", () => {
		for (const value of ["nope", "MATCH", "run ", 7, [], null, undefined]) {
			const parsed = wizardStepValue.safeParse(value);
			assert.ok(parsed.success);
			assert.equal(parsed.data, undefined);
		}
		assert.equal(wizardStepValue.parse("review"), "review");
	});
});

describe("which affordance opened the wizard", () => {
	it("reads the search entry, and everything else as the selection bar", () => {
		assert.equal(wizardEntryFromParam("search"), "search");
		for (const value of [undefined, "", "Search", "bar", 1, null, {}]) {
			assert.equal(wizardEntryFromParam(value), undefined);
		}
	});

	it("never fails validation, so a mistyped link still lands on the mail", () => {
		for (const value of ["nope", "SEARCH", 7, [], null, undefined]) {
			const parsed = wizardEntryValue.safeParse(value);
			assert.ok(parsed.success);
			assert.equal(parsed.data, undefined);
		}
		assert.equal(wizardEntryValue.parse("search"), "search");
	});
});

describe("the history entries the wizard owns", () => {
	it("is one per step reached, on every shape of the list", () => {
		for (const answers of answerSets()) {
			const steps = stepsFor(answers);
			steps.forEach((step, position) => {
				assert.equal(ownedHistoryEntries(steps, step), position + 1);
			});
		}
	});

	it("cannot be moved by the match door, which is answered before it", () => {
		for (const verb of VERBS) {
			for (const scope of SCOPES) {
				const prefixes = MODES.map((mode) =>
					prefixThrough(stepsFor({ verb, mode, scope }), "match"),
				);
				for (const prefix of prefixes) {
					assert.deepEqual(prefix, prefixes[0]);
					for (const step of prefix) {
						const counts = MODES.map((mode) =>
							ownedHistoryEntries(stepsFor({ verb, mode, scope }), step),
						);
						assert.equal(new Set(counts).size, 1);
					}
				}
			}
		}
	});

	it("cannot be moved by the scope, which is answered before it", () => {
		for (const mode of MODES) {
			for (const fromSearch of [false, true]) {
				const listFor = (scope: RuleScope | undefined) =>
					stepsFor({ verb: "organize", mode, scope, fromSearch });
				const prefixes = SCOPES.map((scope) =>
					prefixThrough(listFor(scope), "rule"),
				);
				for (const prefix of prefixes) {
					assert.deepEqual(prefix, prefixes[0]);
					for (const step of prefix) {
						const counts = SCOPES.map((scope) =>
							ownedHistoryEntries(listFor(scope), step),
						);
						assert.equal(new Set(counts).size, 1);
					}
				}
			}
		}
	});

	it("rewinds the whole flow from the steps Back leaves on", () => {
		for (const answers of answerSets()) {
			const steps = stepsFor(answers);
			assert.ok(backExits(steps, steps[0]));
			assert.equal(ownedHistoryEntries(steps, steps[0]), 1);
			const run = steps[steps.length - 1];
			assert.ok(backExits(steps, run));
			assert.equal(ownedHistoryEntries(steps, run), steps.length);
		}
	});

	it("holds a step the answers dropped to the opening entry", () => {
		const steps = stepsFor({ verb: "delete", mode: "selected" });
		assert.equal(stepIndex(steps, "properties"), 0);
		assert.equal(ownedHistoryEntries(steps, "properties"), 1);
	});
});
