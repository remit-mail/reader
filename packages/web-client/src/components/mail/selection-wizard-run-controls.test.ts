/**
 * What the run screen's controls decide (#521, #526).
 *
 * The wizard host wires routing, history and several data hooks together, so
 * the decision is taken out of it and asserted by its result — the same move
 * `runEndingBanner` made for the completion banner. What the run screen then
 * shows for each state is `@remit/ui`'s `selection-wizard.render.test.ts`, and
 * the poll a refresh re-issues is `../../hooks/useOrganizeJob.render.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BulkActionTarget, BulkRunOutcome } from "@/lib/bulk-actions";
import {
	type RetryContext,
	retryIntent,
	runIsInFlight,
	stopRunner,
	wizardExit,
} from "./selection-wizard-run-controls";

const target = (id: string): BulkActionTarget => ({ id, accountId: "acc-1" });

const context = (over: Partial<RetryContext> = {}): RetryContext => ({
	runState: "backApplyComplete",
	isEscalated: false,
	committedScope: "just-these",
	createFilterFailed: false,
	backApplyPending: false,
	widenRunsAsJob: false,
	failedIds: [],
	sent: [target("m1"), target("m2")],
	...over,
});

describe("retrying a run whose status could not be read", () => {
	it("looks at the job it already has rather than queuing a second pass", () => {
		assert.deepEqual(retryIntent(context({ runState: "statusUnknown" })), {
			kind: "refreshStatus",
		});
	});

	// The back-apply is still running on the server, so every other branch —
	// each of which starts something — has to lose to this one.
	for (const over of [
		{ isEscalated: true },
		{ committedScope: "standing" as const, backApplyPending: true },
		{ committedScope: "temporary" as const, createFilterFailed: true },
		{ committedScope: "all-like-these" as const, widenRunsAsJob: true },
		{ committedScope: "just-these" as const },
	]) {
		it(`wins over ${JSON.stringify(over)}`, () => {
			assert.deepEqual(
				retryIntent(context({ ...over, runState: "statusUnknown" })).kind,
				"refreshStatus",
			);
		});
	}
});

describe("retrying an escalated predicate", () => {
	it("re-resolves the predicate rather than resuming a page list", () => {
		assert.deepEqual(retryIntent(context({ isEscalated: true })), {
			kind: "rerunEscalated",
		});
	});
});

describe("retrying a filter that was being saved", () => {
	it("clears the failed create before sending the same commit again", () => {
		assert.deepEqual(
			retryIntent(
				context({ committedScope: "standing", createFilterFailed: true }),
			),
			{ kind: "resetAndResend" },
		);
	});

	it("starts the pass over existing mail when the create landed", () => {
		assert.deepEqual(
			retryIntent(
				context({ committedScope: "temporary", backApplyPending: true }),
			),
			{ kind: "startBackApply" },
		);
	});

	it("starts nothing for a saved filter with no pass behind it", () => {
		assert.deepEqual(retryIntent(context({ committedScope: "standing" })), {
			kind: "waitOnJob",
		});
	});
});

describe("retrying a widened match", () => {
	it("re-sends the commit when the widen runs as a job", () => {
		assert.deepEqual(
			retryIntent(
				context({ committedScope: "all-like-these", widenRunsAsJob: true }),
			),
			{ kind: "resend" },
		);
	});

	it("re-sends the resolved ids when it does not", () => {
		assert.deepEqual(
			retryIntent(context({ committedScope: "all-like-these" })),
			{ kind: "rerunBulk", targets: [target("m1"), target("m2")] },
		);
	});
});

describe("retrying a bounded run", () => {
	it("re-sends only what the run never reached", () => {
		assert.deepEqual(
			retryIntent(
				context({ sent: [target("m1"), target("m2")], failedIds: ["m2"] }),
			),
			{ kind: "rerunBulk", targets: [target("m2")] },
		);
	});

	// A run that threw before it handed anything back reports no failed ids, and
	// re-sending nothing is a retry that silently does nothing at all.
	it("re-sends everything when the run named no id it missed", () => {
		assert.deepEqual(retryIntent(context()), {
			kind: "rerunBulk",
			targets: [target("m1"), target("m2")],
		});
	});

	it("keeps each id's own account, so a cross-account retry still batches", () => {
		const sent = [
			{ id: "m1", accountId: "acc-work" },
			{ id: "m2", accountId: "acc-personal" },
		];
		assert.deepEqual(retryIntent(context({ sent, failedIds: ["m2"] })), {
			kind: "rerunBulk",
			targets: [{ id: "m2", accountId: "acc-personal" }],
		});
	});
});

describe("whether the run screen offers a way to end the run", () => {
	const outcome: BulkRunOutcome = {
		done: 2,
		failedIds: [],
		cancelled: false,
	};

	it("offers nothing before a commit has been sent", () => {
		assert.equal(runIsInFlight(undefined), false);
	});

	it("offers it while the runner is still paging", () => {
		assert.equal(runIsInFlight({}), true);
	});

	it("withdraws it once the runner has handed back an outcome", () => {
		assert.equal(runIsInFlight({ outcome }), false);
	});

	// Nothing was sent, so there is nothing paging to end — the screen carries
	// why instead, and a control claiming to stop a run would stop nothing.
	it("withdraws it for a commit that could not start", () => {
		assert.equal(runIsInFlight({ failureReason: "no Junk folder" }), false);
	});
});

describe("which runner the stop reaches", () => {
	const spies = () => {
		const called: string[] = [];
		return {
			called,
			escalated: { stop: () => called.push("escalated") },
			stopBulk: () => called.push("bulk"),
		};
	};

	it("stops the list's runner when the selection is a predicate", () => {
		const { called, escalated, stopBulk } = spies();
		stopRunner(escalated, stopBulk);
		assert.deepEqual(called, ["escalated"]);
	});

	// A bounded select-all runs on the wizard's own runner and reaches the same
	// control, so a stop that only knows about the predicate leaves that button
	// on screen doing nothing at all.
	it("stops the wizard's own runner for a bounded selection", () => {
		const { called, stopBulk } = spies();
		stopRunner(undefined, stopBulk);
		assert.deepEqual(called, ["bulk"]);
	});
});

describe("which movement the wizard's exit is", () => {
	const movements = () => {
		const called: string[] = [];
		return {
			called,
			handlers: {
				dismiss: () => called.push("dismiss"),
				cancel: () => called.push("cancel"),
			},
		};
	};

	it("walks away from the run on the run screen, leaving it going", () => {
		const { called, handlers } = movements();
		wizardExit("run", handlers)();
		assert.deepEqual(called, ["dismiss"]);
	});

	// Rewinding the entries the wizard owns is only safe before anything is
	// sent; taken off the run screen it offers the commit a second time.
	for (const step of [
		"match",
		"properties",
		"folder",
		"rule",
		"name",
		"review",
	] as const) {
		it(`rewinds the walk from ${step}`, () => {
			const { called, handlers } = movements();
			wizardExit(step, handlers)();
			assert.deepEqual(called, ["cancel"]);
		});
	}
});
