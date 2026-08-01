import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import {
	Counter,
	collectDefaultMetrics,
	Gauge,
	Histogram,
	Registry,
} from "prom-client";

/**
 * The process-wide metric registry every service renders at `/metrics`
 * (docs/design/standalone-observability.md D2/D5). Powertools' `Metrics`
 * emitted CloudWatch Embedded Metric Format, which no configuration turns into
 * a scrape endpoint; this registry is what the endpoint renders.
 *
 * The exported recorders are the only way an application series enters it. The
 * registry itself is exported for a service that owns a signal of its own shape
 * — the queue sidecar's per-queue depth gauges — so the whole process still
 * renders from one registry.
 */
export const registry = new Registry();

/**
 * Heap, resident memory and event-loop lag, read from the process itself. On a
 * self-hosted box memory is the dimension that actually runs out, and nothing
 * else in the deployment reports it.
 *
 * These are unlabelled series present in every service at once, which the
 * application gauges deliberately avoid. A process always knows its own heap,
 * so the value is right in all of them and `instance` tells them apart; a
 * backlog or a queue depth would be a confident zero everywhere it is not
 * computed.
 */
collectDefaultMetrics({ register: registry });

/** Content type of the exposition format `renderMetrics` produces. */
export const metricsContentType = registry.contentType;

/** The port every service that has no listener of its own serves `/metrics` on. */
export const DEFAULT_METRICS_PORT = 9464;

// A mail sync spans three orders of magnitude: a flag push is milliseconds, a
// body fetch or an indexing round runs to the queue's 300 s visibility timeout.
const DURATION_BUCKETS_SECONDS = [0.05, 0.25, 1, 5, 15, 60, 300];

export type HandlerOutcome = "success" | "failure";

/**
 * Authentication is its own kind because it is the one class that never
 * resolves itself: an expired grant or a changed password fails identically
 * forever, and it is the most common way a self-hosted mailbox goes quiet.
 */
export type MailFailureKind = "auth" | "network" | "other";

const handlerDurationSeconds = new Histogram({
	name: "remit_handler_duration_seconds",
	help: "Queue handler invocation duration, by poller target and outcome.",
	labelNames: ["handler", "outcome"],
	buckets: DURATION_BUCKETS_SECONDS,
	registers: [registry],
});

const queueEventDurationSeconds = new Histogram({
	name: "remit_queue_event_duration_seconds",
	help: "Per-message work duration, by queue, event type and outcome.",
	labelNames: ["queue", "event_type", "outcome"],
	buckets: DURATION_BUCKETS_SECONDS,
	registers: [registry],
});

const imapFailuresTotal = new Counter({
	name: "remit_imap_failures_total",
	help: "IMAP operation failures, by operation and failure kind.",
	labelNames: ["operation", "kind"],
	registers: [registry],
});

const smtpFailuresTotal = new Counter({
	name: "remit_smtp_failures_total",
	help: "SMTP send failures, by failure kind.",
	labelNames: ["kind"],
	registers: [registry],
});

const accountSyncAgeSeconds = new Gauge({
	name: "remit_account_sync_age_seconds",
	help: "Seconds since this account last completed a message-sync round.",
	labelNames: ["account_id"],
	registers: [registry],
});

/** One queue handler invocation — a whole SQS batch, from `withTelemetry`. */
export const recordHandlerOutcome = (input: {
	handler: string;
	outcome: HandlerOutcome;
	durationMs: number;
}): void => {
	handlerDurationSeconds.observe(
		{ handler: input.handler, outcome: input.outcome },
		input.durationMs / 1000,
	);
};

/** One message's work, where the worker knows which event it just ran. */
export const recordQueueEvent = (input: {
	queue: string;
	eventType: string;
	outcome: HandlerOutcome;
	durationMs: number;
}): void => {
	queueEventDurationSeconds.observe(
		{ queue: input.queue, event_type: input.eventType, outcome: input.outcome },
		input.durationMs / 1000,
	);
};

export const recordImapFailure = (
	operation: string,
	kind: MailFailureKind,
	count = 1,
): void => {
	imapFailuresTotal.inc({ operation, kind }, count);
};

export const recordSmtpFailure = (kind: MailFailureKind): void => {
	smtpFailuresTotal.inc({ kind });
};

/**
 * The whole per-account series, replaced. Accounts come and go, and a gauge
 * that only ever gains label sets would keep reporting a deleted account's last
 * known age forever.
 */
export const setAccountSyncAges = (
	ages: readonly { accountId: string; ageSeconds: number }[],
): void => {
	accountSyncAgeSeconds.reset();
	for (const { accountId, ageSeconds } of ages) {
		accountSyncAgeSeconds.set({ account_id: accountId }, ageSeconds);
	}
};

type ScrapeCollector = () => Promise<void>;

const scrapeCollectors: ScrapeCollector[] = [];

/**
 * Register work that has to run before a scrape is answered — the gauges whose
 * value is a database read, not something a handler counted. A collector that
 * throws fails the scrape, which is the honest answer: a signal that cannot be
 * evaluated must not render as a healthy number.
 */
export const onScrape = (collector: ScrapeCollector): void => {
	scrapeCollectors.push(collector);
};

// Scrapes are serialised. Both whole-series gauges clear themselves before
// repopulating, so two overlapping scrapes — a scraper's retry, or a Prometheus
// poll landing on top of a `remit doctor` exec — can render one response from a
// gauge the other has just emptied, dropping an account or a queue from it. A
// series an alert evaluates on absence must not flap for that reason.
let inFlightScrape: Promise<string> = Promise.resolve("");

const collectAndRender = async (): Promise<string> => {
	for (const collect of scrapeCollectors) {
		await collect();
	}
	return registry.metrics();
};

export const renderMetrics = (): Promise<string> => {
	inFlightScrape = inFlightScrape.then(collectAndRender, collectAndRender);
	return inFlightScrape;
};

/** Drops every recorded sample and every registered collector — test use only. */
export const resetMetrics = (): void => {
	registry.resetMetrics();
	scrapeCollectors.length = 0;
	inFlightScrape = Promise.resolve("");
};

/**
 * Derive a queue name from an SQS record's `eventSourceARN`. Lambda delivers a
 * real ARN (`arn:aws:sqs:<region>:<account>:<name>`); the standalone poller sets
 * the queue URL it received from (`http://queue:9324/<account>/<name>`). The
 * name is the last segment either way.
 */
export const queueNameFromEventSource = (
	eventSourceArn: string | undefined,
): string => {
	const withoutQuery = (eventSourceArn ?? "").split("?")[0];
	const segments = withoutQuery.split(/[/:]/).filter(Boolean);
	return segments.at(-1) ?? "unknown";
};

const METRICS_PATH = "/metrics";

/**
 * `GET /metrics` and nothing else. No health route (worker liveness is a
 * heartbeat file, not a request path), no other method, no other path.
 */
export type MetricsRequestListener = (
	req: IncomingMessage,
	res: ServerResponse,
) => void;

export const createMetricsRequestListener =
	(): MetricsRequestListener => (req, res) => {
		const path = (req.url ?? "").split("?")[0];
		if (req.method !== "GET" || path !== METRICS_PATH) {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found\n");
			return;
		}
		renderMetrics()
			.then((body) => {
				res.writeHead(200, { "content-type": metricsContentType });
				res.end(body);
			})
			.catch((error: unknown) => {
				res.writeHead(500, { "content-type": "text/plain" });
				res.end(`metrics collection failed: ${String(error)}\n`);
			});
	};

export interface MetricsServerOptions {
	readonly port?: number;
	readonly host?: string;
	/** Where a bind or socket failure is reported. Defaults to a stderr JSON line. */
	readonly onError?: (error: Error) => void;
}

// This module is imported by the logger, so it cannot import the logger back.
// One JSON object on stderr matches the shape every service writes anyway.
const reportToStderr = (error: Error): void => {
	process.stderr.write(
		`${JSON.stringify({
			level: "error",
			time: new Date().toISOString(),
			msg: "metrics server unavailable; this service is serving no metrics",
			error: error.message,
		})}\n`,
	);
};

const MAX_PORT = 65535;

const isBindablePort = (port: number): boolean =>
	Number.isInteger(port) && port >= 0 && port <= MAX_PORT;

// `listen` rejects anything outside 0..65535 by throwing ERR_SOCKET_BAD_PORT
// synchronously, which the `'error'` handler never sees. A blank value is a
// variable someone left empty rather than a request for port 0, so it reads as
// unset; anything else that does not parse is a typo worth naming.
const configuredPort = (override: number | undefined): number | Error => {
	if (override !== undefined) {
		return isBindablePort(override)
			? override
			: new Error(`not a port number: ${override}`);
	}
	const configured = (process.env.METRICS_PORT ?? "").trim();
	if (configured === "") {
		return DEFAULT_METRICS_PORT;
	}
	const parsed = Number(configured);
	return isBindablePort(parsed)
		? parsed
		: new Error(`METRICS_PORT is not a port number: ${configured}`);
};

/**
 * The listener D2 adds to each worker image, for `/metrics` alone. Bound to the
 * compose network and never published to the host: the only host ports in the
 * deployment stay caddy's 80 and 443.
 *
 * A port it cannot bind is reported and then dropped. `listen` resolves on a
 * later tick, by which time the poll loop is already running, so an unhandled
 * `'error'` event here would kill a worker in the middle of syncing mail —
 * 9464 is the OpenTelemetry Prometheus exporter's default, so a collector on
 * the same host is a real trigger. A port that is not a port at all is refused
 * the same way, before `listen` can throw it at the caller. An observability
 * endpoint must never be able to stop mail from arriving; absent metrics are
 * the correct failure.
 *
 * Unreferenced from the event loop, so it never keeps a worker alive past the
 * end of its poll loop.
 */
export const startMetricsServer = (
	options: MetricsServerOptions = {},
): Server => {
	const host = options.host ?? process.env.METRICS_HOST ?? "0.0.0.0";
	const onError = options.onError ?? reportToStderr;
	const server = createServer(createMetricsRequestListener());
	server.unref();
	server.on("error", onError);

	const port = configuredPort(options.port);
	if (port instanceof Error) {
		onError(port);
		return server;
	}

	server.listen(port, host);
	return server;
};
