import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advance } from "./dwell.js";
import { parseMetrics } from "./prometheus.js";
import type { ScrapeResult } from "./scrape.js";
import { type DoctorState, initialState } from "./state.js";
import { type CheckResult, evaluate, type Verdict } from "./verdict.js";

const NOW = new Date("2026-07-27T10:00:00.000Z");

interface Signals {
	readonly deadLetters?: Readonly<Record<string, number>>;
	readonly inFlight?: Readonly<Record<string, number>>;
	readonly syncStalled?: boolean;
	readonly queueDown?: boolean;
}

const queueScrape = (
	deadLetters: Readonly<Record<string, number>>,
	inFlight: Readonly<Record<string, number>>,
) => {
	const lines = [
		'remit_queue_messages{queue="imap-sync",role="work"} 0',
		...Object.entries(deadLetters).map(
			([queue, depth]) =>
				`remit_queue_messages{queue="${queue}",role="dead_letter"} ${depth}`,
		),
		...Object.entries(inFlight).map(
			([queue, depth]) =>
				`remit_queue_messages_in_flight{queue="${queue}",role="dead_letter"} ${depth}`,
		),
	];
	return {
		service: "queue",
		samples: parseMetrics(`${lines.join("\n")}\n`),
		error: undefined,
	};
};

/** One real check, evaluated from the scrapes a stack in this shape exports. */
const check = ({
	deadLetters = {},
	inFlight = {},
	syncStalled = false,
	queueDown = false,
}: Signals = {}): CheckResult => {
	const scrapes: ScrapeResult[] = [
		queueDown
			? { service: "queue", samples: [], error: "fetch failed" }
			: queueScrape(deadLetters, inFlight),
		{
			service: "backend",
			samples: parseMetrics(
				`remit_account_sync_age_seconds{account_id="a"} ${syncStalled ? 99_999 : 60}\n`,
			),
			error: undefined,
		},
	];
	return evaluate({
		scrapes,
		heartbeats: [],
		tunnel: undefined,
		previousCounters: {},
		heartbeatMaxAgeSeconds: 420,
		syncAgeMaxSeconds: 10_800,
		authFailureHoldSeconds: 10_800,
		now: NOW,
	});
};

const BACKLOG = { "mailbox-sync-dlq": 556, "mailbox-body-sync-dlq": 0 };

const byVerdict = (verdict: Verdict): CheckResult =>
	verdict === "healthy" ? check() : check({ deadLetters: { "imap-dlq": 1 } });

/** Feed a run of checks through the machine and collect what it announced. */
const tick = (
	checks: readonly CheckResult[],
	dwell = 3,
	from: DoctorState = initialState,
): { fired: (string | undefined)[]; state: DoctorState } => {
	let state = from;
	const fired: (string | undefined)[] = [];
	for (const result of checks) {
		const transition = advance(state, result, dwell, NOW);
		state = transition.state;
		fired.push(transition.fires);
	}
	return { fired, state };
};

const run = (verdicts: readonly Verdict[], dwell = 3, from = initialState) => {
	const { fired, state } = tick(verdicts.map(byVerdict), dwell, from);
	return {
		fired: fired.map((headline, index) =>
			headline === undefined ? undefined : verdicts[index],
		),
		state,
	};
};

const repeat = <T>(value: T, times: number): T[] =>
	new Array(times).fill(value);

/** A stack whose backlog was announced long ago and has not moved since. */
const degradedByBacklog = (): DoctorState =>
	tick(repeat(check({ deadLetters: BACKLOG }), 5)).state;

describe("the dwell rule", () => {
	it("says nothing on a healthy stack, however long it stays healthy", () => {
		const { fired } = run(repeat("healthy", 5));
		assert.deepEqual(fired, repeat(undefined, 5));
	});

	it("announces a degraded verdict once, on the third agreeing check", () => {
		const { fired } = run(repeat("degraded", 4));
		assert.deepEqual(fired, [undefined, undefined, "degraded", undefined]);
	});

	it("announces the recovery once, three checks later", () => {
		const { fired } = run([
			...repeat<Verdict>("degraded", 3),
			...repeat<Verdict>("healthy", 4),
		]);
		assert.deepEqual(fired, [
			undefined,
			undefined,
			"degraded",
			undefined,
			undefined,
			"healthy",
			undefined,
		]);
	});

	it("stays silent through a flap that never settles", () => {
		const { fired } = run([
			"degraded",
			"healthy",
			"degraded",
			"healthy",
			"degraded",
			"healthy",
			"degraded",
			"healthy",
		]);
		assert.deepEqual(new Set(fired), new Set([undefined]));
	});

	it("stays silent when a degraded run is broken one check short", () => {
		const { fired } = run(["degraded", "degraded", "healthy", "degraded"]);
		assert.deepEqual(fired, [undefined, undefined, undefined, undefined]);
	});

	it("does not re-announce a condition already reported", () => {
		const first = run(repeat("degraded", 3));
		const second = run(repeat("degraded", 4), 3, first.state);
		assert.deepEqual(new Set(second.fired), new Set([undefined]));
	});

	it("survives a restart without re-announcing, because the state is the input", () => {
		const before = run(repeat("degraded", 3)).state;
		// A restart reloads exactly this state from the volume.
		const after = run(repeat("degraded", 3), 3, before);
		assert.deepEqual(new Set(after.fired), new Set([undefined]));
		assert.equal(after.state.firedVerdict, "degraded");
	});

	it("holds the run at the dwell count rather than counting up forever", () => {
		const { state } = run(repeat("healthy", 50));
		assert.equal(state.candidateRuns, 3);
	});

	it("honours a shorter dwell", () => {
		const { fired } = run(["degraded", "degraded"], 1);
		assert.deepEqual(fired, ["degraded", undefined]);
	});

	it("stamps when it last decided", () => {
		const { state } = run(["healthy"]);
		assert.equal(state.updatedAt, NOW.toISOString());
	});

	it("announces the verdict change under the check's own headline", () => {
		const { fired } = tick(repeat(check({ deadLetters: BACKLOG }), 3));
		assert.equal(fired[2], "remit is degraded");
	});
});

describe("news while already degraded", () => {
	it("announces body-sync dead letters arriving behind an old mailbox-sync backlog", () => {
		const { fired } = tick(
			[
				check({ deadLetters: { ...BACKLOG, "mailbox-body-sync-dlq": 12 } }),
				check({ deadLetters: { ...BACKLOG, "mailbox-body-sync-dlq": 12 } }),
			],
			3,
			degradedByBacklog(),
		);
		assert.deepEqual(fired, [
			"remit is still degraded, and worse: 12 more messages on dead-letter queue mailbox-body-sync-dlq (12 in total)",
			undefined,
		]);
	});

	it("announces each further growth with the delta since the last announcement", () => {
		const { fired } = tick(
			[
				check({ deadLetters: { ...BACKLOG, "mailbox-sync-dlq": 557 } }),
				check({ deadLetters: { ...BACKLOG, "mailbox-sync-dlq": 557 } }),
				check({ deadLetters: { ...BACKLOG, "mailbox-sync-dlq": 560 } }),
			],
			3,
			degradedByBacklog(),
		);
		assert.deepEqual(fired, [
			"remit is still degraded, and worse: 1 more message on dead-letter queue mailbox-sync-dlq (557 in total)",
			undefined,
			"remit is still degraded, and worse: 3 more messages on dead-letter queue mailbox-sync-dlq (560 in total)",
		]);
	});

	it("measures growth from where a drained queue fell to", () => {
		const stalled = (depth: number) =>
			check({
				deadLetters: { ...BACKLOG, "mailbox-sync-dlq": depth },
				syncStalled: true,
			});
		const settled = tick(repeat(stalled(556), 3)).state;
		const { fired } = tick([stalled(0), stalled(0), stalled(2)], 3, settled);
		assert.deepEqual(fired, [
			undefined,
			undefined,
			"remit is still degraded, and worse: 2 more messages on dead-letter queue mailbox-sync-dlq (2 in total)",
		]);
	});

	it("does not read a peeked dead letter returning to visible as growth", () => {
		const { fired } = tick(
			[
				check({ deadLetters: BACKLOG, inFlight: { "mailbox-sync-dlq": 0 } }),
				check({
					deadLetters: { ...BACKLOG, "mailbox-sync-dlq": 555 },
					inFlight: { "mailbox-sync-dlq": 1 },
				}),
				check({ deadLetters: BACKLOG, inFlight: { "mailbox-sync-dlq": 0 } }),
			],
			3,
			degradedByBacklog(),
		);
		assert.deepEqual(fired, [undefined, undefined, undefined]);
	});

	it("does not read a queue that briefly stopped answering as growth on its return", () => {
		const { fired } = tick(
			[
				check({ queueDown: true }),
				check({ deadLetters: BACKLOG }),
				check({ deadLetters: BACKLOG }),
			],
			3,
			degradedByBacklog(),
		);
		assert.deepEqual(fired, [undefined, undefined, undefined]);
	});

	it("announces a new reason once it has held for the dwell", () => {
		const worse = check({ deadLetters: BACKLOG, syncStalled: true });
		const { fired } = tick(repeat(worse, 5), 3, degradedByBacklog());
		assert.deepEqual(fired, [
			undefined,
			undefined,
			"remit is still degraded, and worse: new: 1 of 1 account has not completed a sync in over 3h",
			undefined,
			undefined,
		]);
	});

	it("stays silent when a new reason flickers without settling", () => {
		const steady = check({ deadLetters: BACKLOG });
		const worse = check({ deadLetters: BACKLOG, syncStalled: true });
		const { fired } = tick(
			[worse, steady, worse, worse, steady, worse, steady],
			3,
			degradedByBacklog(),
		);
		assert.deepEqual(new Set(fired), new Set([undefined]));
	});

	it("does not re-announce a reason that blinked out for less than the dwell", () => {
		const steady = check({ deadLetters: BACKLOG });
		const worse = check({ deadLetters: BACKLOG, syncStalled: true });
		const announced = tick(repeat(worse, 3), 3, degradedByBacklog()).state;
		const { fired } = tick([steady, steady, worse, worse, worse], 3, announced);
		assert.deepEqual(new Set(fired), new Set([undefined]));
	});

	it("re-announces a reason that cleared for the dwell and came back", () => {
		const steady = check({ deadLetters: BACKLOG });
		const worse = check({ deadLetters: BACKLOG, syncStalled: true });
		const announced = tick(repeat(worse, 3), 3, degradedByBacklog()).state;
		const { fired } = tick(
			[...repeat(steady, 3), ...repeat(worse, 3)],
			3,
			announced,
		);
		assert.equal(fired.filter((headline) => headline).length, 1);
		assert.match(fired[5] ?? "", /new: 1 of 1 account/);
	});

	it("counts a reason carried in a growth announcement as announced", () => {
		const worse = check({
			deadLetters: { ...BACKLOG, "mailbox-body-sync-dlq": 4 },
			syncStalled: true,
		});
		const { fired } = tick(repeat(worse, 3), 3, degradedByBacklog());
		assert.equal(
			fired[0],
			"remit is still degraded, and worse: 4 more messages on dead-letter queue mailbox-body-sync-dlq (4 in total)",
		);
		assert.deepEqual(fired.slice(1), [undefined, undefined]);
	});
});
