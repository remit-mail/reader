import type { HeartbeatReading } from "./heartbeats.js";
import { seriesNamed } from "./prometheus.js";
import type { ScrapeResult } from "./scrape.js";

export type Verdict = "healthy" | "degraded";

export type ReasonCode =
	| "scrape_failed"
	| "worker_heartbeat_stale"
	| "dead_letter_queue_not_empty"
	| "account_sync_stalled"
	| "mail_auth_failing";

/**
 * One thing that is wrong.
 *
 * `summary` carries counts, service names and queue names, and nothing else —
 * D10. It is the only field a webhook payload ever reads, so the rule is a
 * property of the type rather than a habit of the renderer: an address, a
 * subject or an account id in a summary would leave the box, and there is no
 * path by which `detail` can.
 *
 * `detail` is what the operator needs at a shell on the box to act on the
 * reason — the account ids behind "2 of 5 accounts". It is printed by the exec
 * seam and never sent anywhere.
 */
export interface Reason {
	readonly code: ReasonCode;
	readonly summary: string;
	readonly detail: string | undefined;
}

export interface CheckResult {
	readonly verdict: Verdict;
	readonly checkedAt: string;
	readonly summary: string;
	readonly reasons: readonly Reason[];
	/**
	 * Counter totals to compare the next check against. Carried forward
	 * unchanged for any service that did not answer this time, so a scrape
	 * failure cannot manufacture a delta when the service comes back.
	 */
	readonly counters: Readonly<Record<string, number>>;
}

export interface VerdictThresholds {
	readonly heartbeatMaxAgeSeconds: number;
	readonly syncAgeMaxSeconds: number;
}

export interface VerdictInput extends VerdictThresholds {
	readonly scrapes: readonly ScrapeResult[];
	readonly heartbeats: readonly HeartbeatReading[];
	readonly previousCounters: Readonly<Record<string, number>>;
	readonly now: Date;
}

const IMAP_AUTH = "imap-worker:imap_auth_failures";
const SMTP_AUTH = "smtp-worker:smtp_auth_failures";

export const formatDuration = (seconds: number): string => {
	if (seconds >= 3600) {
		const hours = seconds / 3600;
		return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
	}
	if (seconds >= 60) {
		const minutes = seconds / 60;
		return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}m`;
	}
	return `${seconds}s`;
};

const plural = (count: number, one: string, many: string): string =>
	count === 1 ? one : many;

/**
 * "1 of 4 services is not answering". The noun agrees with the total and the
 * verb with the affected count, which is the only combination that reads as
 * English at every pair of numbers.
 */
const outOf = (
	affected: number,
	total: number,
	noun: readonly [string, string],
	verb: readonly [string, string],
): string =>
	`${affected} of ${total} ${plural(total, noun[0], noun[1])} ${plural(affected, verb[0], verb[1])}`;

const scrapeFailures = (
	scrapes: readonly ScrapeResult[],
): Reason | undefined => {
	const failed = scrapes.filter((scrape) => scrape.error !== undefined);
	if (failed.length === 0) return undefined;
	const names = failed.map((scrape) => scrape.service).join(", ");
	return {
		code: "scrape_failed",
		summary: `${outOf(failed.length, scrapes.length, ["service", "services"], ["is", "are"])} not answering /metrics (${names})`,
		detail: failed
			.map((scrape) => `${scrape.service}: ${scrape.error}`)
			.join("; "),
	};
};

const staleHeartbeats = (
	heartbeats: readonly HeartbeatReading[],
	maxAgeSeconds: number,
): Reason | undefined => {
	const stale = heartbeats.filter(
		(reading) =>
			reading.ageSeconds === undefined || reading.ageSeconds > maxAgeSeconds,
	);
	if (stale.length === 0) return undefined;
	const names = stale.map((reading) => reading.service).join(", ");
	return {
		code: "worker_heartbeat_stale",
		summary: `${outOf(stale.length, heartbeats.length, ["worker", "workers"], ["has", "have"])} stopped polling for over ${formatDuration(maxAgeSeconds)} (${names})`,
		detail: stale
			.map((reading) =>
				reading.ageSeconds === undefined
					? `${reading.service}: ${reading.error}`
					: `${reading.service}: ${Math.round(reading.ageSeconds)}s`,
			)
			.join("; "),
	};
};

const deadLetterDepth = (
	samples: readonly ScrapeResult[],
): Reason | undefined => {
	const all = samples.flatMap((scrape) => [...scrape.samples]);
	const occupied = seriesNamed(all, "remit_queue_messages").filter(
		(sample) => sample.labels.role === "dead_letter" && sample.value > 0,
	);
	if (occupied.length === 0) return undefined;
	const total = occupied.reduce((sum, sample) => sum + sample.value, 0);
	const names = occupied
		.map((sample) => sample.labels.queue ?? "unknown")
		.sort()
		.join(", ");
	return {
		code: "dead_letter_queue_not_empty",
		summary: `${total} ${plural(total, "message is", "messages are")} quarantined on ${occupied.length} ${plural(occupied.length, "dead-letter queue", "dead-letter queues")} (${names})`,
		detail: undefined,
	};
};

const stalledSync = (
	samples: readonly ScrapeResult[],
	maxAgeSeconds: number,
): Reason | undefined => {
	const all = samples.flatMap((scrape) => [...scrape.samples]);
	const ages = seriesNamed(all, "remit_account_sync_age_seconds");
	const stalled = ages.filter((sample) => sample.value > maxAgeSeconds);
	if (stalled.length === 0) return undefined;
	return {
		code: "account_sync_stalled",
		// Counts only. Which accounts is on the box, behind `remit doctor`.
		summary: `${outOf(stalled.length, ages.length, ["account", "accounts"], ["has", "have"])} not completed a sync in over ${formatDuration(maxAgeSeconds)}`,
		detail: stalled
			.map(
				(sample) =>
					`${sample.labels.account_id ?? "unknown"}: ${Math.round(sample.value)}s`,
			)
			.sort()
			.join("; "),
	};
};

interface CounterReading {
	readonly key: string;
	readonly total: number | undefined;
	readonly delta: number | undefined;
}

/**
 * Authentication failures are counters, and a counter that has been non-zero
 * since March is not news — an alert on the total fires forever after one
 * expired grant. The signal is the increase since the previous check, which is
 * the one piece of history a checker with a state volume can hold without a
 * time-series database.
 *
 * A service that did not answer has no reading: its previous total is carried
 * forward untouched, so the delta on its return is measured against what it
 * last really exported rather than against a zero nobody observed.
 *
 * A total below the previous one is the exporter having restarted, not work
 * being undone, so the whole current total counts as new.
 */
const readCounter = (
	scrapes: readonly ScrapeResult[],
	key: string,
	service: string,
	metric: string,
	previous: Readonly<Record<string, number>>,
): CounterReading => {
	const scrape = scrapes.find((candidate) => candidate.service === service);
	if (scrape === undefined || scrape.error !== undefined) {
		return { key, total: undefined, delta: undefined };
	}
	const total = seriesNamed(scrape.samples, metric)
		.filter((sample) => sample.labels.kind === "auth")
		.reduce((sum, sample) => sum + sample.value, 0);
	const before = previous[key];
	if (before === undefined) return { key, total, delta: undefined };
	return { key, total, delta: total < before ? total : total - before };
};

const authFailures = (
	readings: readonly CounterReading[],
): Reason | undefined => {
	const rising = readings.filter(
		(reading) => reading.delta !== undefined && reading.delta > 0,
	);
	if (rising.length === 0) return undefined;
	const parts = rising.map((reading) => {
		const protocol = reading.key.startsWith("imap") ? "IMAP" : "SMTP";
		return `${protocol} (${reading.delta} new)`;
	});
	return {
		code: "mail_auth_failing",
		summary: `mail authentication is failing: ${parts.join(", ")}`,
		detail: undefined,
	};
};

const ORDER: readonly ReasonCode[] = [
	"scrape_failed",
	"worker_heartbeat_stale",
	"account_sync_stalled",
	"mail_auth_failing",
	"dead_letter_queue_not_empty",
];

/**
 * The verdict, from the signals as read. Pure: every input is a value, so the
 * loop, the exec seam and the tests all evaluate the same function.
 *
 * A signal that could not be evaluated is `degraded`, never skipped — a
 * `healthy` produced by a check that failed to look is the worst outcome
 * available.
 */
export const evaluate = (input: VerdictInput): CheckResult => {
	const counters = [
		readCounter(
			input.scrapes,
			IMAP_AUTH,
			"imap-worker",
			"remit_imap_failures_total",
			input.previousCounters,
		),
		readCounter(
			input.scrapes,
			SMTP_AUTH,
			"smtp-worker",
			"remit_smtp_failures_total",
			input.previousCounters,
		),
	];

	const found = [
		scrapeFailures(input.scrapes),
		staleHeartbeats(input.heartbeats, input.heartbeatMaxAgeSeconds),
		stalledSync(input.scrapes, input.syncAgeMaxSeconds),
		authFailures(counters),
		deadLetterDepth(input.scrapes),
	].filter((reason): reason is Reason => reason !== undefined);

	const reasons = [...found].sort(
		(left, right) => ORDER.indexOf(left.code) - ORDER.indexOf(right.code),
	);

	const nextCounters = { ...input.previousCounters };
	for (const reading of counters) {
		if (reading.total !== undefined) nextCounters[reading.key] = reading.total;
	}

	const verdict: Verdict = reasons.length === 0 ? "healthy" : "degraded";
	return {
		verdict,
		checkedAt: input.now.toISOString(),
		summary: verdict === "healthy" ? "remit is healthy" : "remit is degraded",
		reasons,
		counters: nextCounters,
	};
};
