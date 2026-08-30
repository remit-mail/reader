/**
 * Everything the checker reads from its environment, in one place, validated
 * once at startup.
 *
 * The `doctor` service takes no `env_file`. It is the one container in the
 * stack that opens an outbound connection to a third-party endpoint, so it
 * holds the variables it needs and none of the deployment's secrets — the
 * compose file passes each of these through by name.
 */
export type ContentType = string;

export interface ScrapeTarget {
	readonly service: string;
	readonly url: string;
}

export interface DoctorConfig {
	readonly intervalMs: number;
	readonly targets: readonly ScrapeTarget[];
	readonly scrapeTimeoutMs: number;
	readonly heartbeatDir: string;
	readonly heartbeatServices: readonly string[];
	readonly heartbeatMaxAgeSeconds: number;
	readonly syncAgeMaxSeconds: number;
	readonly authFailureHoldSeconds: number;
	readonly stateDir: string;
	readonly dwellChecks: number;
	readonly webhookUrl: string | undefined;
	readonly webhookTemplate: string | undefined;
	readonly webhookContentType: ContentType;
	readonly deadManUrl: string | undefined;
	readonly requestTimeoutMs: number;
	readonly logLevel: string | undefined;
	/**
	 * The deployment's `TLS_MODE`, verbatim: the compose service hands it
	 * through as `DOCTOR_TLS_MODE`, so which signals apply stays a property of
	 * how the deployment serves rather than a second value that can disagree
	 * with it. The mode is carried, not a predicate derived from it: the reason
	 * the tunnel signal exists is the mode, and a `tunnelEnabled` boolean here
	 * would put that derivation somewhere no other consumer can see.
	 */
	readonly tlsMode: string;
	readonly tunnelReadyUrl: string;
	/**
	 * The deployment's `SEARCH_EMBEDDING_PROVIDER`, verbatim, handed through as
	 * `DOCTOR_SEARCH_EMBEDDING_PROVIDER` for the same reason `tlsMode` is: which
	 * services are in the stack is a property of how the deployment is
	 * configured. `off` holds `search-index-worker` down behind the `semantic`
	 * compose profile, and a heartbeat file for a service that is deliberately
	 * not running would report an opt-out as a fault forever.
	 */
	readonly searchEmbeddingProvider: string;
}

/**
 * The four endpoints that carry a signal the verdict reads: dead-letter depth,
 * per-account sync age, and the two authentication counters. `account-worker`
 * and `search-index-worker` are absent on purpose — their liveness is a
 * heartbeat file, and scraping a service to prove it is up duplicates a signal
 * that already survives the metrics server failing.
 */
const DEFAULT_TARGETS: readonly ScrapeTarget[] = [
	{ service: "backend", url: "http://backend:8080/metrics" },
	{ service: "queue", url: "http://queue:9324/metrics" },
	{ service: "imap-worker", url: "http://imap-worker:9464/metrics" },
	{ service: "smtp-worker", url: "http://smtp-worker:9464/metrics" },
];

const DEFAULT_HEARTBEAT_SERVICES = [
	"imap-worker",
	"smtp-worker",
	"account-worker",
	"search-index-worker",
];

/**
 * What the checker reports when nothing told it which provider is configured.
 * The compose service always passes the value through, so this is a container
 * started some other way — and the answer is to say it was not told and keep
 * every signal on, never to drop a worker from the watch on an assumption. A
 * check that quietly stops checking is the failure this design exists to remove.
 */
const DEFAULT_SEARCH_EMBEDDING_PROVIDER = "unknown";

/** The provider under which `search-index-worker` is in the stack at all. */
const SEARCH_EMBEDDING_OFF = "off";

/**
 * The worker whose liveness only exists when semantic search is on. Dropped
 * from the default set rather than from the reading, so an operator who names
 * DOCTOR_HEARTBEAT_SERVICES themselves still gets exactly what they asked for.
 */
const SEARCH_INDEX_WORKER = "search-index-worker";

/** The same 420 s the workers' own compose healthcheck uses; one threshold. */
const DEFAULT_HEARTBEAT_MAX_AGE_SECONDS = 420;

/**
 * One hour. `remit_account_sync_age_seconds` sawtooths, and the height of the
 * tooth is the scheduler's OFFLINE interval — the age at which an account
 * becomes due — plus one TICK of sampling lag before a tick picks it up, plus
 * the round itself. At the standalone stack's 15-minute offline interval and
 * 5-minute tick (deploy/vps/docker-compose.sqlite.yml) a healthy account peaks
 * around 25 minutes, so an hour clears it with room for several consecutive
 * failed rounds and still names a genuinely stalled account inside the hour.
 *
 * A threshold below that peak fires on accounts that are fine, which is the
 * failure that matters most here: this is the signal that says mail stopped
 * arriving, and a signal that cries wolf is one an operator learns to ignore.
 * Raise this if you raised either scheduler interval.
 */
const DEFAULT_SYNC_AGE_MAX_SECONDS = 60 * 60;

/**
 * How long after the last authentication failure the condition still counts as
 * failing. One hour, held equal to the sync-age threshold: authentication is
 * retried on the sync cycle, so the failures arrive in one burst per cycle and
 * the gaps between bursts are not recoveries, and two windows of the same width
 * mean a deployment that fixes its password gets one recovery message rather
 * than two.
 *
 * The signal is a counter delta, which is true for exactly one check. Without a
 * hold the reason appears on one check in sixty and the three-check dwell never
 * settles, so the one class of failure that never resolves itself would be the
 * one that never alerts.
 */
const DEFAULT_AUTH_FAILURE_HOLD_SECONDS = 60 * 60;

/** D8's number. Configurable so an operator can trade latency for quiet. */
const DEFAULT_DWELL_CHECKS = 3;

/**
 * A dwell longer than this is indistinguishable from alerting being off, and a
 * container that starts cleanly and never speaks is the worst way to learn that.
 * An hour of agreeing checks is already far past any deliberate setting.
 */
const MAX_DWELL_CHECKS = 60;

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_SCRAPE_TIMEOUT_SECONDS = 10;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 10;

const DEFAULT_CONTENT_TYPE = "application/json";

/** The mode under which the tunnel signal exists at all. */
export const TUNNEL_TLS_MODE = "tunnel";

const DEFAULT_TLS_MODE = "off";

/**
 * `cloudflared`'s readiness endpoint, on the metrics port the compose service
 * gives it. Overridable because the provider contract is generic: another edge
 * supplies its own image, credential variable and readiness endpoint.
 */
const DEFAULT_TUNNEL_READY_URL = "http://tunnel:2000/ready";

export type Env = Record<string, string | undefined>;

const text = (env: Env, name: string): string | undefined => {
	const value = env[name]?.trim();
	return value === undefined || value === "" ? undefined : value;
};

/**
 * A number a human typed. An unparseable or out-of-range value is refused by
 * name rather than silently replaced by the default: a threshold that quietly
 * reverts is a check the operator believes is stricter than it is.
 */
const positiveNumber = (env: Env, name: string, fallback: number): number => {
	const raw = text(env, name);
	if (raw === undefined) return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive number, got: ${raw}`);
	}
	return parsed;
};

/**
 * A count, not a measurement. `2.5` would persist a fractional run in the state
 * file, and a very large value silently turns alerting off while the container
 * starts cleanly and pings its dead-man forever — the failure mode with no
 * symptom, which is the one this whole design exists to remove.
 */
const boundedCount = (
	env: Env,
	name: string,
	fallback: number,
	max: number,
): number => {
	const raw = text(env, name);
	if (raw === undefined) return fallback;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
		throw new Error(
			`${name} must be a whole number of checks between 1 and ${max}, got: ${raw}`,
		);
	}
	return parsed;
};

/** `name=url,name=url`. Written out in full so nothing is inferred from a name. */
export const parseTargets = (raw: string): ScrapeTarget[] =>
	raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "")
		.map((entry) => {
			const separator = entry.indexOf("=");
			if (separator <= 0) {
				throw new Error(
					`DOCTOR_TARGETS entries are <service>=<url>, got: ${entry}`,
				);
			}
			return {
				service: entry.slice(0, separator).trim(),
				url: entry.slice(separator + 1).trim(),
			};
		});

/**
 * D11. A webhook without a dead-man's switch is the half-configuration that
 * looks armed and is not: if the VM dies nothing fires and the channel reads
 * like a quiet week. It is refused at startup, by name, rather than warned
 * about — a warning in a log nobody is watching is the same silence.
 */
export const loadConfig = (env: Env = process.env): DoctorConfig => {
	const webhookUrl = text(env, "DOCTOR_WEBHOOK_URL");
	const deadManUrl = text(env, "DOCTOR_HEARTBEAT_URL");
	if (webhookUrl !== undefined && deadManUrl === undefined) {
		throw new Error(
			"DOCTOR_WEBHOOK_URL is set without DOCTOR_HEARTBEAT_URL. An alert channel " +
				"nothing watches cannot tell a quiet week from a dead box: set " +
				"DOCTOR_HEARTBEAT_URL to a dead-man's-switch URL (healthchecks.io, " +
				"Cronitor, Uptime Kuma), or unset DOCTOR_WEBHOOK_URL.",
		);
	}

	const targetsRaw = text(env, "DOCTOR_TARGETS");
	const servicesRaw = text(env, "DOCTOR_HEARTBEAT_SERVICES");
	const searchEmbeddingProvider =
		text(env, "DOCTOR_SEARCH_EMBEDDING_PROVIDER") ??
		DEFAULT_SEARCH_EMBEDDING_PROVIDER;
	const defaultHeartbeatServices =
		searchEmbeddingProvider === SEARCH_EMBEDDING_OFF
			? DEFAULT_HEARTBEAT_SERVICES.filter(
					(name) => name !== SEARCH_INDEX_WORKER,
				)
			: DEFAULT_HEARTBEAT_SERVICES;

	return {
		intervalMs:
			positiveNumber(env, "DOCTOR_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS) *
			1000,
		targets:
			targetsRaw === undefined ? DEFAULT_TARGETS : parseTargets(targetsRaw),
		scrapeTimeoutMs:
			positiveNumber(
				env,
				"DOCTOR_SCRAPE_TIMEOUT_SECONDS",
				DEFAULT_SCRAPE_TIMEOUT_SECONDS,
			) * 1000,
		heartbeatDir: text(env, "DOCTOR_HEARTBEAT_DIR") ?? "/data/heartbeat",
		heartbeatServices:
			servicesRaw === undefined
				? defaultHeartbeatServices
				: servicesRaw
						.split(",")
						.map((name) => name.trim())
						.filter((name) => name !== ""),
		heartbeatMaxAgeSeconds: positiveNumber(
			env,
			"DOCTOR_HEARTBEAT_MAX_AGE_SECONDS",
			DEFAULT_HEARTBEAT_MAX_AGE_SECONDS,
		),
		syncAgeMaxSeconds: positiveNumber(
			env,
			"DOCTOR_SYNC_AGE_MAX_SECONDS",
			DEFAULT_SYNC_AGE_MAX_SECONDS,
		),
		authFailureHoldSeconds: positiveNumber(
			env,
			"DOCTOR_AUTH_FAILURE_HOLD_SECONDS",
			DEFAULT_AUTH_FAILURE_HOLD_SECONDS,
		),
		stateDir: text(env, "DOCTOR_STATE_DIR") ?? "/data/doctor",
		dwellChecks: boundedCount(
			env,
			"DOCTOR_DWELL_CHECKS",
			DEFAULT_DWELL_CHECKS,
			MAX_DWELL_CHECKS,
		),
		webhookUrl,
		webhookTemplate: text(env, "DOCTOR_WEBHOOK_TEMPLATE"),
		webhookContentType:
			text(env, "DOCTOR_WEBHOOK_CONTENT_TYPE") ?? DEFAULT_CONTENT_TYPE,
		deadManUrl,
		// `DOCTOR_LOG_LEVEL`, because the compose service passes DOCTOR_* variables
		// and nothing else — a plain LOG_LEVEL could never reach this container, so
		// the per-check verdict line could never be turned on.
		logLevel: text(env, "DOCTOR_LOG_LEVEL") ?? text(env, "LOG_LEVEL"),
		requestTimeoutMs:
			positiveNumber(
				env,
				"DOCTOR_REQUEST_TIMEOUT_SECONDS",
				DEFAULT_REQUEST_TIMEOUT_SECONDS,
			) * 1000,
		tlsMode: text(env, "DOCTOR_TLS_MODE") ?? DEFAULT_TLS_MODE,
		tunnelReadyUrl:
			text(env, "DOCTOR_TUNNEL_READY_URL") ?? DEFAULT_TUNNEL_READY_URL,
		searchEmbeddingProvider,
	};
};
