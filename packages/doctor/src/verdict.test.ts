import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HeartbeatReading } from "./heartbeats.js";
import { parseMetrics } from "./prometheus.js";
import type { ScrapeResult } from "./scrape.js";
import type { CounterState } from "./state.js";
import { evaluate, formatDuration, type VerdictInput } from "./verdict.js";

const scrape = (service: string, body: string): ScrapeResult => ({
	service,
	samples: parseMetrics(body),
	error: undefined,
});

const failed = (service: string, error: string): ScrapeResult => ({
	service,
	samples: [],
	error,
});

const fresh = (service: string): HeartbeatReading => ({
	service,
	ageSeconds: 12,
	error: undefined,
});

const HEALTHY_SCRAPES: ScrapeResult[] = [
	scrape("backend", 'remit_account_sync_age_seconds{account_id="a"} 90\n'),
	scrape(
		"queue",
		'remit_queue_messages{queue="imap-sync",role="work"} 2\nremit_queue_messages{queue="imap-sync-dlq",role="dead_letter"} 0\n',
	),
	scrape(
		"imap-worker",
		'remit_imap_failures_total{operation="fetch",kind="auth"} 0\n',
	),
	scrape("smtp-worker", 'remit_smtp_failures_total{kind="auth"} 0\n'),
];

const HEALTHY_HEARTBEATS = [
	fresh("imap-worker"),
	fresh("smtp-worker"),
	fresh("account-worker"),
	fresh("search-index-worker"),
];

const NOW = new Date("2026-07-27T10:00:00.000Z");

/** A counter the checker has already seen, last risen long enough ago to be quiet. */
const counter = (total: number, roseMsAgo = 4 * 60 * 60 * 1000) => ({
	total,
	lastRoseAt: NOW.getTime() - roseMsAgo,
});

const input = (overrides: Partial<VerdictInput> = {}): VerdictInput => ({
	scrapes: HEALTHY_SCRAPES,
	heartbeats: HEALTHY_HEARTBEATS,
	tunnel: undefined,
	previousCounters: {},
	heartbeatMaxAgeSeconds: 420,
	syncAgeMaxSeconds: 10_800,
	authFailureHoldSeconds: 10_800,
	now: NOW,
	...overrides,
});

describe("evaluate", () => {
	it("is healthy when every signal reads clean", () => {
		const result = evaluate(input());
		assert.equal(result.verdict, "healthy");
		assert.deepEqual(result.reasons, []);
		assert.equal(result.summary, "remit is healthy");
		assert.equal(result.checkedAt, "2026-07-27T10:00:00.000Z");
	});

	it("degrades on a target that did not answer, and names the services", () => {
		const result = evaluate(
			input({
				scrapes: [
					failed("backend", "fetch failed"),
					...HEALTHY_SCRAPES.slice(1),
				],
			}),
		);
		assert.equal(result.verdict, "degraded");
		assert.equal(result.reasons[0].code, "scrape_failed");
		assert.match(result.reasons[0].summary, /1 of 4 services is not answering/);
		assert.match(result.reasons[0].summary, /backend/);
	});

	it("degrades on a stale heartbeat", () => {
		const result = evaluate(
			input({
				heartbeats: [
					{ service: "imap-worker", ageSeconds: 900, error: undefined },
					...HEALTHY_HEARTBEATS.slice(1),
				],
			}),
		);
		assert.equal(result.reasons[0].code, "worker_heartbeat_stale");
		assert.match(result.reasons[0].summary, /imap-worker/);
	});

	it("degrades when a worker has no heartbeat file at all, never healthy", () => {
		const result = evaluate(
			input({
				heartbeats: [
					{
						service: "smtp-worker",
						ageSeconds: undefined,
						error: "no heartbeat file",
					},
					...HEALTHY_HEARTBEATS.slice(1),
				],
			}),
		);
		assert.equal(result.verdict, "degraded");
		assert.equal(result.reasons[0].code, "worker_heartbeat_stale");
	});

	it("degrades on a non-empty dead-letter queue and names the queue", () => {
		const result = evaluate(
			input({
				scrapes: [
					HEALTHY_SCRAPES[0],
					scrape(
						"queue",
						'remit_queue_messages{queue="imap-sync-dlq",role="dead_letter"} 3\nremit_queue_messages{queue="smtp-send-dlq",role="dead_letter"} 1\n',
					),
					...HEALTHY_SCRAPES.slice(2),
				],
			}),
		);
		const reason = result.reasons.find(
			(candidate) => candidate.code === "dead_letter_queue_not_empty",
		);
		assert.ok(reason);
		assert.match(
			reason.summary,
			/4 messages are quarantined on 2 dead-letter queues/,
		);
		assert.match(reason.summary, /imap-sync-dlq, smtp-send-dlq/);
	});

	it("degrades on a stalled account, in counts, with the ids only in detail", () => {
		const result = evaluate(
			input({
				scrapes: [
					scrape(
						"backend",
						'remit_account_sync_age_seconds{account_id="aaa"} 40000\nremit_account_sync_age_seconds{account_id="bbb"} 90\n',
					),
					...HEALTHY_SCRAPES.slice(1),
				],
			}),
		);
		const reason = result.reasons[0];
		assert.equal(reason.code, "account_sync_stalled");
		assert.equal(
			reason.summary,
			"1 of 2 accounts has not completed a sync in over 3h",
		);
		assert.ok(!reason.summary.includes("aaa"));
		assert.match(reason.detail ?? "", /aaa/);
	});

	it("says nothing about authentication on the first check, having no baseline", () => {
		const result = evaluate(
			input({
				scrapes: [
					...HEALTHY_SCRAPES.slice(0, 2),
					scrape(
						"imap-worker",
						'remit_imap_failures_total{operation="connect",kind="auth"} 7\n',
					),
					HEALTHY_SCRAPES[3],
				],
			}),
		);
		assert.equal(result.verdict, "healthy");
		assert.deepEqual(result.counters["imap-worker:imap_auth_failures"], {
			total: 7,
			lastRoseAt: null,
		});
	});

	it("degrades when the authentication counter rises, not when it merely stands", () => {
		const withFailures = [
			...HEALTHY_SCRAPES.slice(0, 2),
			scrape(
				"imap-worker",
				'remit_imap_failures_total{operation="connect",kind="auth"} 7\n',
			),
			HEALTHY_SCRAPES[3],
		];
		const standing = evaluate(
			input({
				scrapes: withFailures,
				previousCounters: { "imap-worker:imap_auth_failures": counter(7) },
			}),
		);
		assert.equal(standing.verdict, "healthy");

		const rising = evaluate(
			input({
				scrapes: withFailures,
				previousCounters: { "imap-worker:imap_auth_failures": counter(4) },
			}),
		);
		assert.equal(rising.verdict, "degraded");
		assert.match(rising.reasons[0].summary, /IMAP \(last failure 0s ago\)/);
		assert.equal(
			rising.counters["imap-worker:imap_auth_failures"].lastRoseAt,
			NOW.getTime(),
		);
	});

	// The bug this replaces: the delta is true for one check, the dwell needs
	// three, and the failures arrive one burst per hourly sync tick — so the one
	// class of failure that never resolves itself never alerted.
	it("stays degraded between the bursts, so the dwell can settle", () => {
		const flat = [
			...HEALTHY_SCRAPES.slice(0, 2),
			scrape(
				"imap-worker",
				'remit_imap_failures_total{operation="connect",kind="auth"} 7\n',
			),
			HEALTHY_SCRAPES[3],
		];
		// The check after the rise sees the same total, an hour before the next
		// tick re-tries the password.
		let carried: Readonly<Record<string, CounterState>> = {
			"imap-worker:imap_auth_failures": counter(4),
		};
		for (let check = 0; check < 4; check += 1) {
			const result = evaluate(
				input({ scrapes: flat, previousCounters: carried, now: NOW }),
			);
			assert.equal(result.verdict, "degraded", `check ${check}`);
			assert.equal(result.reasons[0].code, "mail_auth_failing");
			carried = result.counters;
		}
	});

	it("clears once the counter has been flat for the hold window", () => {
		const flat = [
			...HEALTHY_SCRAPES.slice(0, 2),
			scrape(
				"imap-worker",
				'remit_imap_failures_total{operation="connect",kind="auth"} 7\n',
			),
			HEALTHY_SCRAPES[3],
		];
		const inside = evaluate(
			input({
				scrapes: flat,
				previousCounters: {
					"imap-worker:imap_auth_failures": {
						total: 7,
						lastRoseAt: NOW.getTime() - 10_000 * 1000,
					},
				},
			}),
		);
		assert.equal(inside.verdict, "degraded");

		const outside = evaluate(
			input({
				scrapes: flat,
				previousCounters: {
					"imap-worker:imap_auth_failures": {
						total: 7,
						lastRoseAt: NOW.getTime() - 11_000 * 1000,
					},
				},
			}),
		);
		assert.equal(outside.verdict, "healthy");
	});

	it("keeps holding the condition open while the exporter is unreachable", () => {
		const result = evaluate(
			input({
				scrapes: [
					...HEALTHY_SCRAPES.slice(0, 2),
					failed("imap-worker", "connect ECONNREFUSED"),
					HEALTHY_SCRAPES[3],
				],
				previousCounters: {
					"imap-worker:imap_auth_failures": {
						total: 7,
						lastRoseAt: NOW.getTime() - 60_000,
					},
				},
			}),
		);
		assert.ok(
			result.reasons.some((reason) => reason.code === "mail_auth_failing"),
		);
	});

	it("counts the whole total as new when the exporter restarted", () => {
		const result = evaluate(
			input({
				scrapes: [
					...HEALTHY_SCRAPES.slice(0, 3),
					scrape("smtp-worker", 'remit_smtp_failures_total{kind="auth"} 2\n'),
				],
				previousCounters: { "smtp-worker:smtp_auth_failures": counter(50) },
			}),
		);
		assert.match(result.reasons[0].summary, /SMTP \(last failure 0s ago\)/);
	});

	it("ignores failures that are not authentication", () => {
		const result = evaluate(
			input({
				scrapes: [
					...HEALTHY_SCRAPES.slice(0, 2),
					scrape(
						"imap-worker",
						'remit_imap_failures_total{operation="fetch",kind="network"} 99\n',
					),
					HEALTHY_SCRAPES[3],
				],
				previousCounters: { "imap-worker:imap_auth_failures": counter(0) },
			}),
		);
		assert.equal(result.verdict, "healthy");
	});

	it("carries a counter forward untouched when its exporter did not answer", () => {
		const result = evaluate(
			input({
				scrapes: [
					...HEALTHY_SCRAPES.slice(0, 2),
					failed("imap-worker", "connect ECONNREFUSED"),
					HEALTHY_SCRAPES[3],
				],
				previousCounters: { "imap-worker:imap_auth_failures": counter(12) },
			}),
		);
		// The scrape failure degrades the verdict on its own; what must not happen
		// is the baseline dropping to zero and manufacturing a 12-failure delta
		// the moment the worker comes back.
		assert.equal(result.counters["imap-worker:imap_auth_failures"].total, 12);
		assert.ok(
			!result.reasons.some((reason) => reason.code === "mail_auth_failing"),
		);
	});

	it("reports every reason at once, in a stable order", () => {
		const result = evaluate(
			input({
				scrapes: [
					scrape(
						"backend",
						'remit_account_sync_age_seconds{account_id="aaa"} 40000\n',
					),
					scrape(
						"queue",
						'remit_queue_messages{queue="dlq",role="dead_letter"} 1\n',
					),
					...HEALTHY_SCRAPES.slice(2),
				],
				heartbeats: [
					{ service: "imap-worker", ageSeconds: 900, error: undefined },
					...HEALTHY_HEARTBEATS.slice(1),
				],
			}),
		);
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			[
				"worker_heartbeat_stale",
				"account_sync_stalled",
				"dead_letter_queue_not_empty",
			],
		);
	});

	it("degrades when a required series answered but exported nothing", () => {
		const result = evaluate(
			input({
				scrapes: [
					HEALTHY_SCRAPES[0],
					// A 200 with nothing in it: a renamed metric, a collector that
					// started returning [] instead of throwing, a wrong-port target
					// that happens to answer.
					scrape("queue", "# HELP something else\nother_metric 1\n"),
					...HEALTHY_SCRAPES.slice(2),
				],
			}),
		);
		assert.equal(result.verdict, "degraded");
		assert.equal(result.reasons[0].code, "signal_missing");
		assert.match(result.reasons[0].summary, /queue/);
		assert.match(result.reasons[0].detail ?? "", /absent from the response/);
	});

	it("degrades when a required target is not in the target set at all", () => {
		const result = evaluate(
			input({
				// A DOCTOR_TARGETS with no queue endpoint. Nothing errors, nothing is
				// empty — the dead-letter signal is just silently not being read, and
				// reading that as healthy is the headline check failing open.
				scrapes: [HEALTHY_SCRAPES[0], ...HEALTHY_SCRAPES.slice(2)],
			}),
		);
		assert.equal(result.verdict, "degraded");
		assert.equal(result.reasons[0].code, "signal_missing");
		assert.match(result.reasons[0].summary, /queue/);
		assert.match(result.reasons[0].detail ?? "", /no configured target/);
	});

	it("does not require a series from a target that never answered", () => {
		const result = evaluate(
			input({
				scrapes: [
					HEALTHY_SCRAPES[0],
					failed("queue", "connect ECONNREFUSED"),
					...HEALTHY_SCRAPES.slice(2),
				],
			}),
		);
		// scrape_failed already says it; signal_missing would be the same fact twice.
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			["scrape_failed"],
		);
	});

	it("does not require the series a healthy fresh install legitimately lacks", () => {
		const result = evaluate(
			input({
				scrapes: [
					// No accounts yet, so no sync ages and no auth counters.
					scrape("backend", "# HELP nothing yet\n"),
					HEALTHY_SCRAPES[1],
					scrape("imap-worker", "# HELP nothing yet\n"),
					scrape("smtp-worker", "# HELP nothing yet\n"),
				],
			}),
		);
		assert.equal(result.verdict, "healthy");
	});

	it("degrades when the tunnel is not connected, while everything else reads clean", () => {
		const result = evaluate(input({ tunnel: { error: "HTTP 503" } }));
		assert.equal(result.verdict, "degraded");
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			["tunnel_disconnected"],
		);
		assert.match(result.reasons[0].summary, /not connected to its edge/);
		assert.equal(result.reasons[0].detail, "HTTP 503");
	});

	it("stays healthy when the tunnel answered", () => {
		const result = evaluate(input({ tunnel: { error: undefined } }));
		assert.equal(result.verdict, "healthy");
	});

	it("puts the tunnel ahead of the conditions a dropped tunnel does not cause", () => {
		const result = evaluate(
			input({
				tunnel: { error: "connect ECONNREFUSED" },
				heartbeats: [
					{ service: "imap-worker", ageSeconds: 900, error: undefined },
					...HEALTHY_HEARTBEATS.slice(1),
				],
			}),
		);
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			["tunnel_disconnected", "worker_heartbeat_stale"],
		);
	});

	it("keeps every address, subject and folder name out of every summary", () => {
		const result = evaluate(
			input({
				scrapes: [
					scrape(
						"backend",
						'remit_account_sync_age_seconds{account_id="0f8a-secret"} 40000\n',
					),
					...HEALTHY_SCRAPES.slice(1),
				],
			}),
		);
		for (const reason of result.reasons) {
			assert.ok(!reason.summary.includes("0f8a-secret"));
			assert.ok(!reason.summary.includes("@"));
		}
	});
});

// The privacy boundary is meant to be structural, not a habit of the renderer.
// The likeliest way to break it is not a new placeholder — the webhook tests
// catch that — but a NEW REASON whose summary interpolates a label it should
// not. This runs the whole verdict over a scrape where every label D10 forbids
// carries a sentinel, and fails if any of them reaches a summary.
//
// Queue names, service names and operation names are deliberately NOT
// sentinelled: D10 permits those in a payload, and asserting against them would
// make the test forbid what the design allows.
describe("no reason summary may carry a value D10 forbids", () => {
	const SENTINEL = "PII-SENTINEL-b3f1";

	it("keeps every labelled value out of every summary, whatever the reason", () => {
		const poisoned: ScrapeResult[] = [
			scrape(
				"backend",
				`remit_account_sync_age_seconds{account_id="${SENTINEL}"} 99999\n`,
			),
			scrape(
				"queue",
				'remit_queue_messages{queue="remit-body-dlq",role="dead_letter"} 3\n',
			),
			// `folder` and `mailbox` do not exist on these series today. They are
			// here as the labels a future contributor is most likely to add and
			// then interpolate: D10 forbids both by name.
			scrape(
				"imap-worker",
				`remit_imap_failures_total{operation="fetch",kind="auth",folder="${SENTINEL}"} 9\n`,
			),
			scrape(
				"smtp-worker",
				`remit_smtp_failures_total{kind="auth",mailbox="${SENTINEL}"} 9\n`,
			),
		];
		const result = evaluate(
			input({
				scrapes: poisoned,
				heartbeats: [
					{ service: "imap-worker", ageSeconds: undefined, error: SENTINEL },
					...HEALTHY_HEARTBEATS.slice(1),
				],
				tunnel: { error: SENTINEL },
				previousCounters: {
					"imap-worker:imap_auth_failures": counter(0),
					"smtp-worker:smtp_auth_failures": counter(0),
				},
			}),
		);

		// Every reason this deployment can produce is present, so the assertion
		// covers the whole set rather than whichever one happened to fire.
		assert.deepEqual(result.reasons.map((reason) => reason.code).sort(), [
			"account_sync_stalled",
			"dead_letter_queue_not_empty",
			"mail_auth_failing",
			"tunnel_disconnected",
			"worker_heartbeat_stale",
		]);
		for (const reason of result.reasons) {
			assert.ok(
				!reason.summary.includes(SENTINEL),
				`${reason.code} leaked a label value into its summary: ${reason.summary}`,
			);
		}
	});

	it("is a real test — the same sentinel does reach the local-only detail", () => {
		const result = evaluate(
			input({
				scrapes: [
					scrape(
						"backend",
						`remit_account_sync_age_seconds{account_id="${SENTINEL}"} 99999\n`,
					),
					...HEALTHY_SCRAPES.slice(1),
				],
			}),
		);
		assert.match(result.reasons[0].detail ?? "", new RegExp(SENTINEL));
	});
});

describe("formatDuration", () => {
	it("renders the units an operator reads a threshold in", () => {
		assert.equal(formatDuration(45), "45s");
		assert.equal(formatDuration(420), "7m");
		assert.equal(formatDuration(450), "7.5m");
		assert.equal(formatDuration(10_800), "3h");
		assert.equal(formatDuration(5400), "1.5h");
	});
});
