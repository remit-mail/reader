import type { HeartbeatReading } from "./heartbeats.js";
import { seriesNamed } from "./prometheus.js";
import type { ScrapeResult } from "./scrape.js";
import type { CounterState } from "./state.js";
import type { TunnelReading } from "./tunnel.js";

export type Verdict = "healthy" | "degraded";

export type ReasonCode =
	| "scrape_failed"
	| "worker_heartbeat_stale"
	| "dead_letter_queue_not_empty"
	| "account_sync_stalled"
	| "mail_auth_failing"
	| "signal_missing"
	| "tunnel_disconnected";

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
 *
 * The boundary is enforced by a test, not by the type: `verdict.test.ts` runs
 * every reason over a scrape whose `account_id`, `folder` and `mailbox` labels
 * are a sentinel and asserts no summary contains it. That is a tripwire, not a
 * guarantee — it cannot catch a NEW reason derived from a series the fixture
 * does not carry, and the `deepEqual` on the reason-code set only makes such a
 * reason noticeable, not safe.
 *
 * The thing that would actually scale this to reasons nobody has written yet is
 * a branded `Summary` type that only a sanitising constructor can produce, so
 * interpolating a raw label into one is a compile error rather than a review
 * catch. If you are adding a reason and reaching for a label value here, that is
 * the change to make first.
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
	readonly counters: Readonly<Record<string, CounterState>>;
}

export interface VerdictThresholds {
	readonly heartbeatMaxAgeSeconds: number;
	readonly syncAgeMaxSeconds: number;
	readonly authFailureHoldSeconds: number;
}

export interface VerdictInput extends VerdictThresholds {
	readonly scrapes: readonly ScrapeResult[];
	readonly heartbeats: readonly HeartbeatReading[];
	readonly previousCounters: Readonly<Record<string, CounterState>>;
	/**
	 * The tunnel's readiness, or `undefined` on a deployment that does not serve
	 * through one. Absent is not-applicable here, unlike every other signal,
	 * where absent is degraded: a deployment with no tunnel has no tunnel to be
	 * disconnected from.
	 */
	readonly tunnel: TunnelReading | undefined;
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
	/** `undefined` when the exporting service did not answer this check. */
	readonly state: CounterState | undefined;
	/** How much it went up by, when this check is the one that saw it rise. */
	readonly delta: number | undefined;
}

/**
 * Authentication failures are counters, and a counter that has been non-zero
 * since March is not news — an alert on the total fires forever after one
 * expired grant. The increase since the previous check is the one piece of
 * history a checker with a state volume can hold without a time-series
 * database.
 *
 * That increase is true for exactly one check, which is not long enough to
 * satisfy a dwell, so `lastRoseAt` turns the instant into a condition: the
 * signal stays on until the counter has stopped rising for the hold window.
 * Failures arrive in one burst per sync tick, so the quiet stretch between two
 * bursts is not a recovery and must not read as one.
 *
 * A service that did not answer has no reading: its previous state is carried
 * forward untouched, so the delta on its return is measured against what it
 * last really exported rather than against a zero nobody observed — and its
 * `lastRoseAt` keeps holding the condition open across the outage.
 *
 * A total below the previous one is the exporter having restarted, not work
 * being undone, so the whole current total counts as new.
 */
const readCounter = (
	scrapes: readonly ScrapeResult[],
	key: string,
	service: string,
	metric: string,
	previous: Readonly<Record<string, CounterState>>,
	now: number,
): CounterReading => {
	const before = previous[key];
	const scrape = scrapes.find((candidate) => candidate.service === service);
	if (scrape === undefined || scrape.error !== undefined) {
		return { key, state: before, delta: undefined };
	}
	const total = seriesNamed(scrape.samples, metric)
		.filter((sample) => sample.labels.kind === "auth")
		.reduce((sum, sample) => sum + sample.value, 0);
	if (before === undefined) {
		// First sight of the counter is a baseline, not an event. Whatever it
		// already holds happened before this checker was watching.
		return { key, state: { total, lastRoseAt: null }, delta: undefined };
	}
	const delta = total < before.total ? total : total - before.total;
	if (delta <= 0) return { key, state: { ...before, total }, delta: undefined };
	return { key, state: { total, lastRoseAt: now }, delta };
};

const PROTOCOL: Readonly<Record<string, string>> = {
	[IMAP_AUTH]: "IMAP",
	[SMTP_AUTH]: "SMTP",
};

/**
 * Failing while the counter is still rising, and for `holdSeconds` after the
 * last rise. The summary says how long ago rather than how many, because the
 * count is an artefact of the retry cadence and the age is the fact the
 * operator acts on.
 */
const authFailures = (
	readings: readonly CounterReading[],
	holdSeconds: number,
	now: number,
): Reason | undefined => {
	const failing = readings.filter((reading) => {
		const rose = reading.state?.lastRoseAt;
		return (
			rose !== undefined && rose !== null && now - rose <= holdSeconds * 1000
		);
	});
	if (failing.length === 0) return undefined;
	const parts = failing.map((reading) => {
		const since = Math.max(0, now - (reading.state?.lastRoseAt ?? now)) / 1000;
		return `${PROTOCOL[reading.key] ?? "mail"} (last failure ${formatDuration(Math.round(since))} ago)`;
	});
	return {
		code: "mail_auth_failing",
		// No address and no account id: the counters carry neither, and the
		// operator identifies the mailbox by running `remit doctor` on the box.
		summary: `mail authentication is failing: ${parts.join(", ")}`,
		detail: undefined,
	};
};

/**
 * A 200 that carries no samples is not a healthy service. A metric rename, a
 * collector that starts returning nothing instead of throwing, or a target on
 * the wrong port that happens to answer 200 would all render as "nothing
 * wrong", which is the `healthy`-produced-by-a-check-that-failed-to-look that
 * D4 rules out.
 *
 * Only `remit_queue_messages` is required. It is the one series a working
 * deployment always exports — the queue set is declared in `queues.json` and
 * the sidecar renders a sample per queue whether or not anything is on it.
 * `remit_account_sync_age_seconds` is legitimately empty on a fresh install
 * with no mailbox yet, and the auth counters do not exist until something has
 * failed once, so neither can be required without alerting on a healthy
 * install.
 */
const REQUIRED_SERIES: readonly { service: string; metric: string }[] = [
	{ service: "queue", metric: "remit_queue_messages" },
];

const missingSeries = (
	scrapes: readonly ScrapeResult[],
): Reason | undefined => {
	const missing = REQUIRED_SERIES.flatMap(({ service, metric }) => {
		const scrape = scrapes.find((candidate) => candidate.service === service);
		// Not configured at all is missing, not fine. A `DOCTOR_TARGETS` with no
		// queue endpoint would otherwise read healthy with the dead-letter signal
		// silently gone — the epic's headline check failing open, and the one
		// failure mode with no symptom.
		if (scrape === undefined) {
			return [{ service, why: `${metric} has no configured target` }];
		}
		// A target that did not answer is already `scrape_failed`. Saying it twice
		// tells the operator nothing and costs a line in the alert.
		if (scrape.error !== undefined) return [];
		return seriesNamed(scrape.samples, metric).length === 0
			? [{ service, why: `${metric} absent from the response` }]
			: [];
	});
	if (missing.length === 0) return undefined;
	return {
		code: "signal_missing",
		summary: `${missing.length} ${plural(missing.length, "signal", "signals")} the check depends on ${plural(missing.length, "is", "are")} not being read (${missing.map(({ service }) => service).join(", ")})`,
		detail: missing.map(({ service, why }) => `${service}: ${why}`).join("; "),
	};
};

/**
 * The stack can be entirely healthy and still be serving nobody: in `tunnel`
 * mode the only route in is the agent's connection to the edge, and when it
 * drops every other signal here stays green while the browser gets the
 * provider's error page.
 *
 * The checker's own two outbound calls — the webhook and the dead-man ping —
 * dial straight out and do not pass through the agent, so this is the one
 * reason that is still delivered while the condition it reports holds.
 */
const disconnectedTunnel = (
	tunnel: TunnelReading | undefined,
): Reason | undefined => {
	if (tunnel === undefined || tunnel.error === undefined) return undefined;
	return {
		code: "tunnel_disconnected",
		summary:
			"the tunnel agent is not connected to its edge, so the public address serves nobody",
		detail: tunnel.error,
	};
};

const ORDER: readonly ReasonCode[] = [
	"scrape_failed",
	"signal_missing",
	"tunnel_disconnected",
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
	const now = input.now.getTime();
	const counters = [
		readCounter(
			input.scrapes,
			IMAP_AUTH,
			"imap-worker",
			"remit_imap_failures_total",
			input.previousCounters,
			now,
		),
		readCounter(
			input.scrapes,
			SMTP_AUTH,
			"smtp-worker",
			"remit_smtp_failures_total",
			input.previousCounters,
			now,
		),
	];

	const found = [
		scrapeFailures(input.scrapes),
		missingSeries(input.scrapes),
		disconnectedTunnel(input.tunnel),
		staleHeartbeats(input.heartbeats, input.heartbeatMaxAgeSeconds),
		stalledSync(input.scrapes, input.syncAgeMaxSeconds),
		authFailures(counters, input.authFailureHoldSeconds, now),
		deadLetterDepth(input.scrapes),
	].filter((reason): reason is Reason => reason !== undefined);

	const reasons = [...found].sort(
		(left, right) => ORDER.indexOf(left.code) - ORDER.indexOf(right.code),
	);

	const nextCounters = { ...input.previousCounters };
	for (const reading of counters) {
		if (reading.state !== undefined) nextCounters[reading.key] = reading.state;
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
