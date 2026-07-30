import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	createMetricsRequestListener,
	DEFAULT_METRICS_PORT,
	metricsContentType,
	onScrape,
	queueNameFromEventSource,
	recordHandlerOutcome,
	recordImapFailure,
	recordQueueEvent,
	recordSmtpFailure,
	registry,
	renderMetrics,
	resetMetrics,
	setAccountSyncAges,
	startMetricsServer,
} from "./metrics.js";

/** A `#{name}{labels} value` line, matched on the labels a test cares about. */
const sample = (text: string, name: string, labels: string[] = []): number => {
	const line = text
		.split("\n")
		.find(
			(candidate) =>
				candidate.startsWith(`${name}{`) ||
				(labels.length === 0 && candidate.startsWith(`${name} `)),
		);
	const matching = text
		.split("\n")
		.filter(
			(candidate) =>
				candidate.startsWith(name) &&
				labels.every((label) => candidate.includes(label)),
		);
	const chosen = labels.length > 0 ? matching[0] : line;
	assert.ok(
		chosen,
		`expected a sample for ${name}${labels.join("")} in:\n${text}`,
	);
	return Number(chosen.slice(chosen.lastIndexOf(" ") + 1));
};

const get = async (
	port: number,
	path: string,
): Promise<{ status: number; contentType: string; body: string }> => {
	const response = await fetch(`http://127.0.0.1:${port}${path}`);
	return {
		status: response.status,
		contentType: response.headers.get("content-type") ?? "",
		body: await response.text(),
	};
};

describe("metrics registry", () => {
	beforeEach(() => resetMetrics());

	it("renders exposition text with a HELP and TYPE line per metric", async () => {
		recordHandlerOutcome({
			handler: "imap-worker-body",
			outcome: "success",
			durationMs: 1500,
		});
		const text = await renderMetrics();
		assert.match(text, /^# HELP remit_handler_duration_seconds .+$/m);
		assert.match(text, /^# TYPE remit_handler_duration_seconds histogram$/m);
	});

	it("records handler duration in seconds, by target and outcome", async () => {
		recordHandlerOutcome({
			handler: "smtp-worker",
			outcome: "failure",
			durationMs: 2500,
		});
		const text = await renderMetrics();
		assert.equal(
			sample(text, "remit_handler_duration_seconds_sum", [
				'handler="smtp-worker"',
				'outcome="failure"',
			]),
			2.5,
		);
		assert.equal(
			sample(text, "remit_handler_duration_seconds_count", [
				'handler="smtp-worker"',
				'outcome="failure"',
			]),
			1,
		);
	});

	it("records per-message work by queue, event type and outcome", async () => {
		recordQueueEvent({
			queue: "remit-body",
			eventType: "SYNC_MESSAGE_BODY",
			outcome: "success",
			durationMs: 1000,
		});
		recordQueueEvent({
			queue: "remit-body",
			eventType: "SYNC_MESSAGE_BODY",
			outcome: "failure",
			durationMs: 500,
		});
		const text = await renderMetrics();
		assert.equal(
			sample(text, "remit_queue_event_duration_seconds_count", [
				'queue="remit-body"',
				'event_type="SYNC_MESSAGE_BODY"',
				'outcome="success"',
			]),
			1,
		);
		assert.equal(
			sample(text, "remit_queue_event_duration_seconds_sum", [
				'outcome="failure"',
			]),
			0.5,
		);
	});

	it("counts IMAP authentication failures apart from other kinds", async () => {
		recordImapFailure("SYNC_MESSAGES", "auth");
		recordImapFailure("SYNC_MESSAGES", "auth");
		recordImapFailure("SYNC_MESSAGES", "network");
		const text = await renderMetrics();
		assert.equal(
			sample(text, "remit_imap_failures_total", [
				'operation="SYNC_MESSAGES"',
				'kind="auth"',
			]),
			2,
		);
		assert.equal(
			sample(text, "remit_imap_failures_total", ['kind="network"']),
			1,
		);
	});

	it("counts SMTP authentication failures apart from other kinds", async () => {
		recordSmtpFailure("auth");
		recordSmtpFailure("other");
		const text = await renderMetrics();
		assert.equal(sample(text, "remit_smtp_failures_total", ['kind="auth"']), 1);
		assert.equal(
			sample(text, "remit_smtp_failures_total", ['kind="other"']),
			1,
		);
	});

	it("labels sync age by account id and never by address", async () => {
		setAccountSyncAges([
			{ accountId: "acct-1", ageSeconds: 42 },
			{ accountId: "acct-2", ageSeconds: 900 },
		]);
		const text = await renderMetrics();
		assert.equal(
			sample(text, "remit_account_sync_age_seconds", ['account_id="acct-1"']),
			42,
		);
		assert.equal(
			sample(text, "remit_account_sync_age_seconds", ['account_id="acct-2"']),
			900,
		);
		assert.ok(!text.includes("@"));
	});

	it("drops the sync age series of an account that is gone", async () => {
		setAccountSyncAges([{ accountId: "acct-1", ageSeconds: 42 }]);
		setAccountSyncAges([{ accountId: "acct-2", ageSeconds: 7 }]);
		const text = await renderMetrics();
		assert.ok(!text.includes('account_id="acct-1"'));
		assert.equal(
			sample(text, "remit_account_sync_age_seconds", ['account_id="acct-2"']),
			7,
		);
	});

	it("declares no unlabelled series, so no process renders a value it cannot know", async () => {
		const text = await renderMetrics();
		const samples = text
			.split("\n")
			.filter((line) => line.length > 0 && !line.startsWith("#"));
		assert.deepEqual(
			samples,
			[],
			"a fresh registry must render nothing until something records",
		);
	});

	it("runs registered collectors before rendering", async () => {
		let ran = 0;
		onScrape(async () => {
			ran += 1;
			recordSmtpFailure("other");
		});
		const text = await renderMetrics();
		assert.equal(ran, 1);
		assert.equal(
			sample(text, "remit_smtp_failures_total", ['kind="other"']),
			1,
		);
	});

	it("serialises overlapping scrapes so neither sees the other's reset", async () => {
		// The sync-age gauge clears itself before repopulating. Two scrapes that
		// interleave would let one render from the gauge the other just emptied.
		let renders = 0;
		onScrape(async () => {
			setAccountSyncAges([{ accountId: "acct-1", ageSeconds: 1 }]);
			await new Promise((resolve) => setImmediate(resolve));
			renders += 1;
		});
		const [first, second] = await Promise.all([
			renderMetrics(),
			renderMetrics(),
		]);
		assert.equal(renders, 2);
		for (const text of [first, second]) {
			assert.equal(
				sample(text, "remit_account_sync_age_seconds", ['account_id="acct-1"']),
				1,
			);
		}
	});

	it("recovers after a scrape that failed", async () => {
		let fail = true;
		onScrape(async () => {
			if (fail) {
				fail = false;
				throw new Error("transient");
			}
			recordSmtpFailure("auth");
		});
		await assert.rejects(renderMetrics(), /transient/);
		const text = await renderMetrics();
		assert.equal(sample(text, "remit_smtp_failures_total", ['kind="auth"']), 1);
	});

	it("fails the render when a collector cannot evaluate its signal", async () => {
		onScrape(async () => {
			throw new Error("database is gone");
		});
		await assert.rejects(renderMetrics(), /database is gone/);
	});
});

describe("queueNameFromEventSource", () => {
	it("reads the queue name from a real SQS ARN", () => {
		assert.equal(
			queueNameFromEventSource("arn:aws:sqs:eu-west-1:123456789012:remit-body"),
			"remit-body",
		);
	});

	it("reads the queue name from the sidecar queue URL the poller passes", () => {
		assert.equal(
			queueNameFromEventSource(
				"http://queue:9324/000000000000/remit-flags.fifo",
			),
			"remit-flags.fifo",
		);
	});

	it("ignores a query string", () => {
		assert.equal(
			queueNameFromEventSource("http://queue:9324/0/remit-smtp?x=1"),
			"remit-smtp",
		);
	});

	it("reports unknown rather than guessing when the source is absent", () => {
		assert.equal(queueNameFromEventSource(undefined), "unknown");
	});
});

describe("the /metrics endpoint", () => {
	const servers: { close: (cb: () => void) => void }[] = [];

	const listen = async (): Promise<number> => {
		const server = startMetricsServer({ port: 0, host: "127.0.0.1" });
		servers.push(server);
		await new Promise<void>((resolve) => server.once("listening", resolve));
		return (server.address() as AddressInfo).port;
	};

	beforeEach(() => resetMetrics());

	afterEach(async () => {
		while (servers.length > 0) {
			const server = servers.pop();
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
	});

	it("serves Prometheus text on GET /metrics", async () => {
		recordSmtpFailure("auth");
		const port = await listen();
		const response = await get(port, "/metrics");
		assert.equal(response.status, 200);
		assert.equal(response.contentType, metricsContentType);
		assert.match(response.contentType, /^text\/plain/);
		assert.match(response.body, /^# TYPE remit_smtp_failures_total counter$/m);
		assert.match(
			response.body,
			/^remit_smtp_failures_total\{kind="auth"\} 1$/m,
		);
	});

	it("serves /metrics with a query string attached", async () => {
		const port = await listen();
		assert.equal((await get(port, "/metrics?debug=1")).status, 200);
	});

	it("serves nothing else — no health route, no other path", async () => {
		const port = await listen();
		assert.equal((await get(port, "/health")).status, 404);
		assert.equal((await get(port, "/")).status, 404);
	});

	it("refuses any method other than GET", async () => {
		const port = await listen();
		const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
			method: "POST",
		});
		assert.equal(response.status, 404);
	});

	it("answers 500 when a signal cannot be evaluated", async () => {
		onScrape(async () => {
			throw new Error("queue store unreachable");
		});
		const port = await listen();
		const response = await get(port, "/metrics");
		assert.equal(response.status, 500);
		assert.match(response.body, /queue store unreachable/);
	});

	it("defaults to the documented port when none is configured", () => {
		assert.equal(DEFAULT_METRICS_PORT, 9464);
	});

	it("survives a port it cannot bind instead of taking the process down", async () => {
		const held = await listen();
		const reported: Error[] = [];
		const server = startMetricsServer({
			port: held,
			host: "127.0.0.1",
			onError: (error) => reported.push(error),
		});
		servers.push(server);
		await new Promise<void>((resolve) => server.once("error", () => resolve()));
		assert.equal(reported.length, 1);
		assert.match(String(reported[0]), /EADDRINUSE/);
		// The port that was already bound still answers: nothing died.
		assert.equal((await get(held, "/metrics")).status, 200);
	});

	it("reports a bind failure as one JSON line on stderr by default", async () => {
		const held = await listen();
		const written: string[] = [];
		const restore = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		const server = startMetricsServer({ port: held, host: "127.0.0.1" });
		servers.push(server);
		await new Promise<void>((resolve) => server.once("error", () => resolve()));
		process.stderr.write = restore;

		assert.equal(written.length, 1);
		const line = JSON.parse(written[0]) as {
			level: string;
			msg: string;
			error: string;
		};
		assert.equal(line.level, "error");
		assert.match(line.msg, /serving no metrics/);
		assert.match(line.error, /EADDRINUSE/);
	});

	it("reads the host from METRICS_HOST", async () => {
		process.env.METRICS_HOST = "127.0.0.1";
		const server = startMetricsServer({ port: 0 });
		servers.push(server);
		await new Promise<void>((resolve) => server.once("listening", resolve));
		delete process.env.METRICS_HOST;
		assert.equal((server.address() as AddressInfo).address, "127.0.0.1");
	});

	it("reads the port from METRICS_PORT", async () => {
		const listener = createMetricsRequestListener();
		assert.equal(typeof listener, "function");
		process.env.METRICS_PORT = "0";
		const server = startMetricsServer({ host: "127.0.0.1" });
		servers.push(server);
		await new Promise<void>((resolve) => server.once("listening", resolve));
		delete process.env.METRICS_PORT;
		assert.ok((server.address() as AddressInfo).port > 0);
	});

	const startWithMetricsPort = (value: string, reported: Error[]) => {
		process.env.METRICS_PORT = value;
		try {
			return startMetricsServer({
				host: "127.0.0.1",
				onError: (error) => reported.push(error),
			});
		} finally {
			delete process.env.METRICS_PORT;
		}
	};

	for (const value of ["nine-thousand", "99999", "-1", "9464.5"]) {
		it(`refuses to bind METRICS_PORT=${value} instead of taking the worker down`, () => {
			const reported: Error[] = [];
			const server = startWithMetricsPort(value, reported);
			assert.equal(server.listening, false);
			assert.equal(reported.length, 1);
			assert.match(reported[0].message, /METRICS_PORT/);
			assert.ok(reported[0].message.includes(value));
		});
	}

	it("treats a blank METRICS_PORT as unconfigured", async () => {
		const reported: Error[] = [];
		const server = startWithMetricsPort("  ", reported);
		servers.push(server);
		const bound = await new Promise<boolean>((resolve) => {
			server.once("listening", () => resolve(true));
			server.once("error", () => resolve(false));
		});
		if (!bound) {
			// 9464 is already taken on this host, which is itself proof the
			// fallback resolved to it: an ephemeral port is never in use.
			assert.match(String(reported[0]), /EADDRINUSE/);
			return;
		}
		assert.deepEqual(reported, []);
		assert.equal((server.address() as AddressInfo).port, DEFAULT_METRICS_PORT);
	});

	it("refuses an out-of-range port passed by a caller", () => {
		const reported: Error[] = [];
		const server = startMetricsServer({
			port: 70000,
			host: "127.0.0.1",
			onError: (error) => reported.push(error),
		});
		assert.equal(server.listening, false);
		assert.equal(reported.length, 1);
		assert.match(reported[0].message, /70000/);
	});

	it("reports a malformed port as one JSON line on stderr by default", () => {
		const written: string[] = [];
		const restore = process.stderr.write.bind(process.stderr);
		process.env.METRICS_PORT = "not-a-port";
		process.stderr.write = ((chunk: string) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		let server: Server;
		try {
			server = startMetricsServer({ host: "127.0.0.1" });
		} finally {
			process.stderr.write = restore;
			delete process.env.METRICS_PORT;
		}

		assert.equal(server.listening, false);
		assert.equal(written.length, 1);
		const line = JSON.parse(written[0]) as { level: string; error: string };
		assert.equal(line.level, "error");
		assert.match(line.error, /not-a-port/);
	});
});
