import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { clearHeartbeats, createHeartbeat } from "./heartbeat.js";

const heartbeatPrefix = async (): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), "remit-heartbeat-"));
	return join(dir, "imap-worker");
};

describe("createHeartbeat", () => {
	afterEach(() => {
		delete process.env.WORKER_HEARTBEAT_PREFIX;
	});

	it("writes one file per queue and advances its mtime on the next beat", async () => {
		const prefix = await heartbeatPrefix();
		const body = createHeartbeat("remit-body", prefix);
		const flags = createHeartbeat("remit-flags.fifo", prefix);

		await body();
		await flags();
		assert.deepEqual((await readdir(dirname(prefix))).sort(), [
			"imap-worker.remit-body",
			"imap-worker.remit-flags.fifo",
		]);

		const contents = await readFile(`${prefix}.remit-body`, "utf8");
		assert.ok(
			!Number.isNaN(Date.parse(contents.trim())),
			`heartbeat contents should be a timestamp, got ${contents}`,
		);

		// The healthcheck reads mtime and nothing else, so a rewrite that leaves
		// the file byte-identical would have to advance it anyway.
		const first = await stat(`${prefix}.remit-body`);
		await new Promise((resolve) => setTimeout(resolve, 20));
		await body();
		const second = await stat(`${prefix}.remit-body`);
		assert.ok(
			second.mtimeMs > first.mtimeMs,
			`the second beat did not advance mtime: ${second.mtimeMs} <= ${first.mtimeMs}`,
		);
	});

	it("writes under WORKER_HEARTBEAT_PREFIX when no prefix is given", async () => {
		const prefix = await heartbeatPrefix();
		process.env.WORKER_HEARTBEAT_PREFIX = prefix;

		await createHeartbeat("remit-smtp")();

		assert.equal((await stat(`${prefix}.remit-smtp`)).isFile(), true);
	});

	it("writes nothing when WORKER_HEARTBEAT_PREFIX is unset", async () => {
		const prefix = await heartbeatPrefix();

		await createHeartbeat("remit-smtp")();

		assert.deepEqual(await readdir(dirname(prefix)), []);
	});

	it("rejects when the heartbeat directory does not exist", async () => {
		const heartbeat = createHeartbeat(
			"remit-smtp",
			"/nonexistent/remit/worker",
		);

		await assert.rejects(() => heartbeat(), /ENOENT/);
	});
});

describe("clearHeartbeats", () => {
	afterEach(() => {
		delete process.env.WORKER_HEARTBEAT_PREFIX;
	});

	it("removes this service's files and leaves every other service's alone", async () => {
		const prefix = await heartbeatPrefix();
		const directory = dirname(prefix);
		await writeFile(`${prefix}.remit-body`, "stale\n");
		await writeFile(`${prefix}.remit-retired-queue`, "stale\n");
		await writeFile(join(directory, "smtp-worker.remit-smtp"), "fresh\n");

		await clearHeartbeats(prefix);

		assert.deepEqual(await readdir(directory), ["smtp-worker.remit-smtp"]);
	});

	it("does nothing when WORKER_HEARTBEAT_PREFIX is unset", async () => {
		await clearHeartbeats();
	});

	it("rejects when the heartbeat directory does not exist", async () => {
		await assert.rejects(
			() => clearHeartbeats("/nonexistent/remit/worker"),
			/ENOENT/,
		);
	});
});
