import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";
import type { Log } from "./log.js";
import { type LoopDependencies, runLoop, runOnce, sleep } from "./loop.js";
import { type DoctorState, initialState } from "./state.js";
import type { CheckResult, Verdict } from "./verdict.js";

const NOW = new Date("2026-07-27T10:00:00.000Z");

const silent: Log = { debug: () => {}, info: () => {}, error: () => {} };

const result = (verdict: Verdict): CheckResult => ({
	verdict,
	checkedAt: NOW.toISOString(),
	summary: `remit is ${verdict}`,
	reasons:
		verdict === "healthy"
			? []
			: [
					{
						code: "dead_letter_queue_not_empty",
						summary: "1 message is quarantined on 1 dead-letter queue (dlq)",
						detail: undefined,
					},
				],
	counters: {
		"imap-worker:imap_auth_failures": { total: 1, lastRoseAt: null },
	},
});

interface Recorder {
	readonly deps: LoopDependencies;
	readonly posted: Verdict[];
	readonly pings: number[];
	readonly saved: DoctorState[];
}

const recorder = (
	verdicts: readonly Verdict[],
	overrides: Partial<LoopDependencies> = {},
): Recorder => {
	const posted: Verdict[] = [];
	const pings: number[] = [];
	const saved: DoctorState[] = [];
	let index = 0;
	return {
		posted,
		pings,
		saved,
		deps: {
			runCheck: async () =>
				result(verdicts[Math.min(index++, verdicts.length - 1)]),
			saveState: async (state) => {
				saved.push(state);
			},
			postWebhook: async (check) => {
				posted.push(check.verdict);
				return { kind: "sent" as const };
			},
			pingDeadMan: async () => {
				pings.push(pings.length);
			},
			now: () => NOW,
			log: silent,
			...overrides,
		},
	};
};

const configured = loadConfig({
	DOCTOR_WEBHOOK_URL: "https://hooks.example/x",
	DOCTOR_HEARTBEAT_URL: "https://hc.example/x",
	DOCTOR_INTERVAL_SECONDS: "1",
});

describe("runOnce", () => {
	it("sends nothing until the verdict settles, then sends it once", async () => {
		const rec = recorder(["degraded", "degraded", "degraded", "degraded"]);
		let state = initialState;
		for (let turn = 0; turn < 4; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
		}
		assert.deepEqual(rec.posted, ["degraded"]);
	});

	it("pings the dead-man on every completed check, settled or not", async () => {
		const rec = recorder(["healthy", "degraded", "degraded"]);
		let state = initialState;
		for (let turn = 0; turn < 3; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
		}
		assert.equal(rec.pings.length, 3);
	});

	it("pings even when the verdict is degraded because a scrape failed", async () => {
		const rec = recorder(["degraded"]);
		await runOnce(rec.deps, configured, initialState);
		assert.equal(rec.pings.length, 1);
	});

	it("carries the counter baseline forward into the persisted state", async () => {
		const rec = recorder(["healthy"]);
		const state = await runOnce(rec.deps, configured, initialState);
		assert.deepEqual(state.counters, {
			"imap-worker:imap_auth_failures": { total: 1, lastRoseAt: null },
		});
	});

	it("spends the transition on a payload the endpoint refused", async () => {
		// A 4xx is the endpoint deciding about this body — a template written
		// wrong, a revoked URL. Repeating it produces the same answer forever.
		let attempts = 0;
		const rec = recorder(new Array(6).fill("degraded"), {
			postWebhook: async () => {
				attempts += 1;
				return { kind: "rejected" as const, detail: "HTTP 400" };
			},
		});
		let state = initialState;
		for (let turn = 0; turn < 6; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
		}
		assert.equal(attempts, 1);
		assert.equal(state.firedVerdict, "degraded");
		assert.equal(rec.pings.length, 6);
	});

	it("retries a transition the endpoint never received, on the next check", async () => {
		// One transient 5xx on the firing check used to lose the outage alert
		// outright: the dead-man's switch is a different URL at a different
		// provider and keeps answering 200 while the webhook is down.
		let attempts = 0;
		const rec = recorder(new Array(6).fill("degraded"), {
			postWebhook: async () => {
				attempts += 1;
				return attempts < 3
					? { kind: "unreachable" as const, detail: "HTTP 503" }
					: { kind: "sent" as const };
			},
		});
		let state = initialState;
		for (let turn = 0; turn < 6; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
			if (turn < 2) assert.equal(state.firedVerdict, "healthy", `turn ${turn}`);
		}
		// Tried on the settling check and on each of the two after it, then landed
		// and stopped.
		assert.equal(attempts, 3);
		assert.equal(state.firedVerdict, "degraded");
	});

	it("treats a thrown delivery as unreachable, not as a decision", async () => {
		let attempts = 0;
		const rec = recorder(new Array(5).fill("degraded"), {
			postWebhook: async () => {
				attempts += 1;
				throw new Error("socket hang up");
			},
		});
		let state = initialState;
		for (let turn = 0; turn < 5; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
		}
		assert.equal(attempts, 3);
		assert.equal(state.firedVerdict, "healthy");
	});

	it("keeps the settled run while retrying, so the retry is not another dwell away", async () => {
		const rec = recorder(new Array(4).fill("degraded"), {
			postWebhook: async () => ({
				kind: "unreachable" as const,
				detail: "HTTP 503",
			}),
		});
		let state = initialState;
		for (let turn = 0; turn < 4; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
		}
		assert.equal(state.candidateRuns, 3);
	});

	it("still pings when the webhook cannot be delivered", async () => {
		const rec = recorder(["degraded", "degraded", "degraded"], {
			postWebhook: async () => {
				throw new Error("HTTP 400");
			},
		});
		let state = initialState;
		for (let turn = 0; turn < 3; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
		}
		assert.equal(rec.pings.length, 3);
	});

	it("keeps running when the dead-man ping fails", async () => {
		const rec = recorder(["healthy"], {
			pingDeadMan: async () => {
				throw new Error("unreachable");
			},
		});
		await assert.doesNotReject(runOnce(rec.deps, configured, initialState));
	});

	it("records the decision only after the endpoint has answered about it", async () => {
		const order: string[] = [];
		const rec = recorder(["degraded", "degraded", "degraded"], {
			saveState: async () => {
				order.push("save");
			},
			postWebhook: async () => {
				order.push("post");
				return { kind: "sent" as const };
			},
		});
		let state = initialState;
		for (let turn = 0; turn < 3; turn += 1) {
			state = await runOnce(rec.deps, configured, state);
		}
		// The write follows the post, so a crash in the gap re-announces once.
		// A duplicate is noise; a dropped outage alert is the failure this exists
		// to prevent.
		assert.deepEqual(order, ["save", "save", "post", "save"]);
	});

	it("sends nothing at all when no webhook is configured", async () => {
		const rec = recorder(["degraded", "degraded", "degraded"]);
		const quiet = loadConfig({});
		let state = initialState;
		for (let turn = 0; turn < 3; turn += 1) {
			state = await runOnce(rec.deps, quiet, state);
		}
		assert.deepEqual(rec.posted, []);
		assert.deepEqual(rec.pings, []);
		// The verdict is still computed and recorded — `remit doctor` needs it.
		assert.equal(state.firedVerdict, "degraded");
	});
});

describe("runLoop", () => {
	it("keeps going after a check that throws, and does not ping for it", async () => {
		let calls = 0;
		const rec = recorder(["healthy"], {
			runCheck: async () => {
				calls += 1;
				if (calls === 1) throw new Error("scrape blew up");
				return result("healthy");
			},
		});
		const controller = new AbortController();
		let turns = 0;
		await runLoop({
			config: configured,
			initial: initialState,
			signal: controller.signal,
			deps: rec.deps,
			sleep: async () => {
				turns += 1;
				if (turns >= 3) controller.abort();
			},
		});
		assert.equal(calls, 3);
		// Two of the three checks produced a verdict; the one that threw did not.
		assert.equal(rec.pings.length, 2);
	});

	it("stops on abort", async () => {
		const rec = recorder(["healthy"]);
		const controller = new AbortController();
		controller.abort();
		const state = await runLoop({
			config: configured,
			initial: initialState,
			signal: controller.signal,
			deps: rec.deps,
			sleep: async () => {},
		});
		assert.deepEqual(state, initialState);
	});
});

describe("sleep", () => {
	it("returns early on abort", async () => {
		const controller = new AbortController();
		const started = Date.now();
		const waiting = sleep(60_000, controller.signal);
		controller.abort();
		await waiting;
		assert.ok(Date.now() - started < 1000);
	});

	it("returns immediately when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		await sleep(60_000, controller.signal);
	});

	it("returns when the timer fires", async () => {
		await sleep(1, new AbortController().signal);
	});
});
