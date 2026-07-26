import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createHeartbeat } from "./heartbeat.js";

const heartbeatFile = async (): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), "remit-heartbeat-"));
	return join(dir, "imap-worker");
};

describe("createHeartbeat", () => {
	afterEach(() => {
		delete process.env.WORKER_HEARTBEAT_FILE;
	});

	it("creates the file on the first beat and advances its mtime on the next", async () => {
		const path = await heartbeatFile();
		const heartbeat = createHeartbeat(path);

		await heartbeat();
		const first = await stat(path);
		const firstContents = await readFile(path, "utf8");
		assert.ok(
			!Number.isNaN(Date.parse(firstContents.trim())),
			`heartbeat contents should be a timestamp, got ${firstContents}`,
		);

		// The healthcheck reads mtime and nothing else, so a rewrite that leaves
		// the file byte-identical would have to advance it anyway.
		await new Promise((resolve) => setTimeout(resolve, 20));
		await heartbeat();
		const second = await stat(path);
		assert.ok(
			second.mtimeMs > first.mtimeMs,
			`the second beat did not advance mtime: ${second.mtimeMs} <= ${first.mtimeMs}`,
		);
	});

	it("writes the file named by WORKER_HEARTBEAT_FILE when no path is given", async () => {
		const path = await heartbeatFile();
		process.env.WORKER_HEARTBEAT_FILE = path;

		await createHeartbeat()();

		assert.equal((await stat(path)).isFile(), true);
	});

	it("writes nothing when WORKER_HEARTBEAT_FILE is unset", async () => {
		const path = await heartbeatFile();

		await createHeartbeat()();

		await assert.rejects(() => stat(path), /ENOENT/);
	});

	it("fails loudly when the heartbeat directory does not exist", async () => {
		const heartbeat = createHeartbeat("/nonexistent/remit/heartbeat/worker");

		await assert.rejects(() => heartbeat(), /ENOENT/);
	});
});
