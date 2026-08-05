import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runCheck } from "./check.js";
import { loadConfig } from "./config.js";

const BODIES: Readonly<Record<string, string>> = {
	backend: 'remit_account_sync_age_seconds{account_id="aaa"} 120\n',
	queue: 'remit_queue_messages{queue="imap-sync-dlq",role="dead_letter"} 0\n',
	"imap-worker": 'remit_imap_failures_total{operation="fetch",kind="auth"} 0\n',
	"smtp-worker": 'remit_smtp_failures_total{kind="auth"} 0\n',
};

const stack = (overrides: Readonly<Record<string, string>> = {}) =>
	(async (url: string) => {
		const service = new URL(url).hostname;
		const body = overrides[service] ?? BODIES[service];
		if (body === undefined) throw new Error(`no such service: ${service}`);
		return new Response(body, { status: 200 });
	}) as unknown as typeof fetch;

/**
 * The stack plus a tunnel agent, recording every URL the check asks for. A
 * `status` of `undefined` is an agent that is not there to answer at all.
 */
const withTunnel = (
	inner: typeof fetch,
	status: number | undefined,
	seen: string[],
) =>
	(async (url: string, init?: RequestInit) => {
		seen.push(url);
		if (new URL(url).hostname !== "tunnel") return inner(url, init);
		if (status === undefined) {
			throw new Error("connect ECONNREFUSED 172.18.0.9:2000");
		}
		return new Response("", { status });
	}) as unknown as typeof fetch;

const ALL_WORKERS = [
	"imap-worker",
	"smtp-worker",
	"account-worker",
	"search-index-worker",
];

const heartbeatDir = async (services: readonly string[]): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "remit-doctor-check-"));
	for (const service of services) {
		await writeFile(join(directory, `${service}.queue`), "now\n");
	}
	return directory;
};

describe("runCheck", () => {
	it("reads both surfaces and produces one verdict", async () => {
		const directory = await heartbeatDir([
			"imap-worker",
			"smtp-worker",
			"account-worker",
			"search-index-worker",
		]);
		const config = loadConfig({ DOCTOR_HEARTBEAT_DIR: directory });
		const result = await runCheck(config, {}, new Date(), stack());
		assert.equal(result.verdict, "healthy");
	});

	it("degrades on the heartbeat surface even when every scrape is clean", async () => {
		const config = loadConfig({
			DOCTOR_HEARTBEAT_DIR: await heartbeatDir(["imap-worker"]),
		});
		const result = await runCheck(config, {}, new Date(), stack());
		assert.equal(result.verdict, "degraded");
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			["worker_heartbeat_stale"],
		);
	});

	it("degrades on the metrics surface even when every heartbeat is fresh", async () => {
		const config = loadConfig({
			DOCTOR_HEARTBEAT_DIR: await heartbeatDir([
				"imap-worker",
				"smtp-worker",
				"account-worker",
				"search-index-worker",
			]),
		});
		const result = await runCheck(
			config,
			{},
			new Date(),
			stack({
				queue:
					'remit_queue_messages{queue="imap-sync-dlq",role="dead_letter"} 4\n',
			}),
		);
		assert.equal(result.verdict, "degraded");
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			["dead_letter_queue_not_empty"],
		);
	});
});

describe("runCheck in tunnel mode", () => {
	const tunnelConfig = async () =>
		loadConfig({
			DOCTOR_HEARTBEAT_DIR: await heartbeatDir(ALL_WORKERS),
			DOCTOR_TLS_MODE: "tunnel",
		});

	it("degrades when the readiness endpoint does not answer 200", async () => {
		const seen: string[] = [];
		const result = await runCheck(
			await tunnelConfig(),
			{},
			new Date(),
			withTunnel(stack(), 503, seen),
		);
		assert.equal(result.verdict, "degraded");
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			["tunnel_disconnected"],
		);
		assert.ok(seen.includes("http://tunnel:2000/ready"));
	});

	it("degrades when the agent does not answer at all", async () => {
		const result = await runCheck(
			await tunnelConfig(),
			{},
			new Date(),
			withTunnel(stack(), undefined, []),
		);
		assert.deepEqual(
			result.reasons.map((reason) => reason.code),
			["tunnel_disconnected"],
		);
	});

	it("stays silent while the readiness endpoint answers 200", async () => {
		const result = await runCheck(
			await tunnelConfig(),
			{},
			new Date(),
			withTunnel(stack(), 200, []),
		);
		assert.equal(result.verdict, "healthy");
	});

	it("asks the endpoint the deployment named", async () => {
		const seen: string[] = [];
		await runCheck(
			loadConfig({
				DOCTOR_HEARTBEAT_DIR: await heartbeatDir(ALL_WORKERS),
				DOCTOR_TLS_MODE: "tunnel",
				DOCTOR_TUNNEL_READY_URL: "http://tunnel:2000/healthz",
			}),
			{},
			new Date(),
			withTunnel(stack(), 200, seen),
		);
		assert.ok(seen.includes("http://tunnel:2000/healthz"));
	});

	it("never looks for a tunnel on a deployment that does not serve through one", async () => {
		const seen: string[] = [];
		const result = await runCheck(
			loadConfig({ DOCTOR_HEARTBEAT_DIR: await heartbeatDir(ALL_WORKERS) }),
			{},
			new Date(),
			// The agent is absent, as it is on every other mode. Probing it anyway
			// would be the check degrading a healthy deployment.
			withTunnel(stack(), undefined, seen),
		);
		assert.equal(result.verdict, "healthy");
		assert.ok(!seen.some((url) => new URL(url).hostname === "tunnel"));
	});
});
