import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	type DoctorState,
	initialState,
	parseState,
	readState,
	STATE_VERSION,
	stateFile,
	writeState,
} from "./state.js";

const temporaryDir = () => mkdtemp(join(tmpdir(), "remit-doctor-state-"));

const state: DoctorState = {
	version: STATE_VERSION,
	firedVerdict: "degraded",
	candidateVerdict: "degraded",
	candidateRuns: 3,
	counters: {
		"imap-worker:imap_auth_failures": { total: 4, lastRoseAt: 1785142027000 },
	},
	updatedAt: "2026-07-27T10:00:00.000Z",
};

describe("parseState", () => {
	it("round-trips what writeState writes", async () => {
		assert.deepEqual(await parseState(JSON.stringify(state)), state);
	});

	it("falls back to the baseline rather than refusing to start", async () => {
		assert.deepEqual(await parseState("not json at all"), initialState);
		assert.deepEqual(await parseState("null"), initialState);
		assert.deepEqual(await parseState('"a string"'), initialState);
		assert.deepEqual(await parseState('{"version":3}'), initialState);
		assert.deepEqual(
			await parseState('{"version":2,"firedVerdict":"broken"}'),
			initialState,
		);
		assert.deepEqual(
			await parseState(
				'{"version":2,"firedVerdict":"healthy","candidateVerdict":"healthy","candidateRuns":"three","counters":{}}',
			),
			initialState,
		);
		assert.deepEqual(
			await parseState(
				'{"version":2,"firedVerdict":"healthy","candidateVerdict":"healthy","candidateRuns":1,"counters":{"a":"b"}}',
			),
			initialState,
		);
	});

	it("assumes a stack nobody has checked is healthy, so no install announces itself", () => {
		assert.equal(initialState.firedVerdict, "healthy");
	});

	it("resets a state file written by the version before the counter timestamps", async () => {
		// v1 stored `counters` as bare totals, which cannot say when a counter last
		// rose. Reading one as a baseline would leave the auth signal unable to
		// hold, so the file is replaced; the cost is at most one repeated alert.
		assert.deepEqual(
			await parseState(
				'{"version":1,"firedVerdict":"degraded","candidateVerdict":"degraded","candidateRuns":3,"counters":{"imap-worker:imap_auth_failures":4}}',
			),
			initialState,
		);
	});

	it("tolerates a missing updatedAt", async () => {
		const parsed = await parseState(
			'{"version":2,"firedVerdict":"healthy","candidateVerdict":"healthy","candidateRuns":1,"counters":{}}',
		);
		assert.equal(parsed.updatedAt, undefined);
	});
});

describe("readState and writeState", () => {
	it("persists across a read", async () => {
		const directory = await temporaryDir();
		await writeState(directory, state);
		assert.deepEqual(await readState(directory), state);
	});

	it("creates its directory", async () => {
		const directory = join(await temporaryDir(), "nested", "deeper");
		await writeState(directory, state);
		assert.deepEqual(await readState(directory), state);
	});

	it("reads a directory with no state file as a fresh install", async () => {
		assert.deepEqual(await readState(await temporaryDir()), initialState);
	});

	it("reads a truncated file as a fresh install rather than throwing", async () => {
		const directory = await temporaryDir();
		await writeFile(stateFile(directory), '{"version":1,"fired');
		assert.deepEqual(await readState(directory), initialState);
	});

	it("renames into place, so a kill mid-write cannot truncate the live file", async () => {
		const directory = await temporaryDir();
		await writeState(directory, state);
		await writeState(directory, { ...state, candidateRuns: 1 });
		const raw = await readFile(stateFile(directory), "utf8");
		assert.equal(JSON.parse(raw).candidateRuns, 1);
	});
});
