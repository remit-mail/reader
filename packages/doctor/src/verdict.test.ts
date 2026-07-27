import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HeartbeatReading } from "./heartbeats.js";
import { parseMetrics } from "./prometheus.js";
import type { ScrapeResult } from "./scrape.js";
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

const input = (overrides: Partial<VerdictInput> = {}): VerdictInput => ({
	scrapes: HEALTHY_SCRAPES,
	heartbeats: HEALTHY_HEARTBEATS,
	previousCounters: {},
	heartbeatMaxAgeSeconds: 420,
	syncAgeMaxSeconds: 10_800,
	now: new Date("2026-07-27T10:00:00.000Z"),
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
		assert.equal(result.counters["imap-worker:imap_auth_failures"], 7);
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
				previousCounters: { "imap-worker:imap_auth_failures": 7 },
			}),
		);
		assert.equal(standing.verdict, "healthy");

		const rising = evaluate(
			input({
				scrapes: withFailures,
				previousCounters: { "imap-worker:imap_auth_failures": 4 },
			}),
		);
		assert.equal(rising.verdict, "degraded");
		assert.match(rising.reasons[0].summary, /IMAP \(3 new\)/);
	});

	it("counts the whole total as new when the exporter restarted", () => {
		const result = evaluate(
			input({
				scrapes: [
					...HEALTHY_SCRAPES.slice(0, 3),
					scrape("smtp-worker", 'remit_smtp_failures_total{kind="auth"} 2\n'),
				],
				previousCounters: { "smtp-worker:smtp_auth_failures": 50 },
			}),
		);
		assert.match(result.reasons[0].summary, /SMTP \(2 new\)/);
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
				previousCounters: { "imap-worker:imap_auth_failures": 0 },
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
				previousCounters: { "imap-worker:imap_auth_failures": 12 },
			}),
		);
		// The scrape failure degrades the verdict on its own; what must not happen
		// is the baseline dropping to zero and manufacturing a 12-failure delta
		// the moment the worker comes back.
		assert.equal(result.counters["imap-worker:imap_auth_failures"], 12);
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

describe("formatDuration", () => {
	it("renders the units an operator reads a threshold in", () => {
		assert.equal(formatDuration(45), "45s");
		assert.equal(formatDuration(420), "7m");
		assert.equal(formatDuration(450), "7.5m");
		assert.equal(formatDuration(10_800), "3h");
		assert.equal(formatDuration(5400), "1.5h");
	});
});
