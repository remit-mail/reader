import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readHeartbeats } from "./heartbeats.js";

const SERVICES = ["imap-worker", "smtp-worker"];
const NOW = Date.parse("2026-07-27T10:00:00.000Z");

const withFiles = async (
	files: Readonly<Record<string, number>>,
): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "remit-doctor-hb-"));
	for (const [name, ageSeconds] of Object.entries(files)) {
		const path = join(directory, name);
		await writeFile(path, "2026-07-27T09:00:00.000Z\n");
		const when = new Date(NOW - ageSeconds * 1000);
		await utimes(path, when, when);
	}
	return directory;
};

describe("readHeartbeats", () => {
	it("reports the age of a service's stalest loop, not its freshest", async () => {
		const directory = await withFiles({
			"imap-worker.imap-sync": 5,
			"imap-worker.imap-flag-push": 900,
			"smtp-worker.smtp-send": 10,
		});
		const readings = await readHeartbeats(directory, SERVICES, NOW);
		assert.equal(readings[0].ageSeconds, 900);
		assert.equal(readings[1].ageSeconds, 10);
	});

	it("reports a service with no file as unreadable, never as age zero", async () => {
		const directory = await withFiles({ "imap-worker.imap-sync": 5 });
		const [, smtp] = await readHeartbeats(directory, SERVICES, NOW);
		assert.equal(smtp.ageSeconds, undefined);
		assert.equal(smtp.error, "no heartbeat file");
	});

	it("reports every service as unreadable when the directory is not there", async () => {
		const readings = await readHeartbeats(
			"/nonexistent/heartbeat",
			SERVICES,
			NOW,
		);
		assert.deepEqual(
			readings.map((reading) => reading.ageSeconds),
			[undefined, undefined],
		);
		assert.match(readings[0].error ?? "", /cannot read/);
	});

	it("does not mistake one service's file for another's prefix", async () => {
		const directory = await withFiles({
			"imap-worker-extra.queue": 5,
			"imap-worker.imap-sync": 20,
		});
		const [imap] = await readHeartbeats(directory, ["imap-worker"], NOW);
		assert.equal(imap.ageSeconds, 20);
	});

	it("reads no services as no readings", async () => {
		assert.deepEqual(await readHeartbeats(await withFiles({}), [], NOW), []);
	});
});
