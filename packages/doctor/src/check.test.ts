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
