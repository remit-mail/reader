import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EmbeddingService } from "@remit/search-service";
import {
	type AdaptiveEmbeddingConfig,
	createAdaptiveEmbeddingService,
	type EmbeddingPlan,
	type GovernorDeps,
	MemoryGovernor,
	MemoryStallTimeoutError,
	readAdaptiveEmbeddingConfigFromEnv,
} from "./adaptive-embedder.js";
import type { MemoryReader } from "./memory.js";

const MB = 1024 * 1024;

const CONFIG: AdaptiveEmbeddingConfig = {
	minBatchSize: 2,
	maxBatchSize: 8,
	maxConcurrency: 2,
	headroomBytes: 768 * MB,
	rampMarginBytes: 256 * MB,
	rampAfterReadings: 3,
	rssCeilingBytes: 1536 * MB,
	criticalBytes: 384 * MB,
	pauseMs: 10,
	stallMaxMs: 100,
};

/** Comfortably above `headroomBytes + rampMarginBytes`. */
const ROOMY = 2000;
/** Above the shed threshold but inside the ramp margin: the dead band. */
const DEAD_BAND = [800, 780, 900, 820, 1000, 790];

interface Reading {
	availableMb: number;
	rssMb?: number;
}

/** One entry per read; the last value repeats forever. */
const reads = (script: readonly Reading[]): MemoryReader => {
	let next = 0;
	return () => {
		const entry = script[Math.min(next, script.length - 1)];
		next += 1;
		return {
			availableBytes: entry.availableMb * MB,
			rssBytes: (entry.rssMb ?? 512) * MB,
		};
	};
};

const available = (...availableMb: number[]): MemoryReader =>
	reads(availableMb.map((mb) => ({ availableMb: mb })));

class Harness {
	readonly plans: EmbeddingPlan[] = [];
	readonly sleeps: number[] = [];
	readonly lines: string[] = [];
	stalls = 0;
	beats = 0;
	clock = 0;
	beatFails = false;
	readonly deps: GovernorDeps;

	constructor(readMemory: MemoryReader) {
		const record = (message: string) => {
			this.lines.push(message);
		};
		this.deps = {
			readMemory,
			// A fake clock advanced by the waits themselves, so the stall budget is
			// exercised without spending it.
			sleep: async (ms) => {
				this.sleeps.push(ms);
				this.clock += ms;
			},
			now: () => this.clock,
			log: { info: record, warn: record, error: record },
			beat: async () => {
				this.beats += 1;
				if (this.beatFails) throw new Error("no space left on device");
			},
			onPlan: (plan) => {
				this.plans.push(plan);
			},
			onStall: () => {
				this.stalls += 1;
			},
		};
	}
}

const harness = (readMemory: MemoryReader): Harness => new Harness(readMemory);

const settleTimes = (governor: MemoryGovernor, times: number): void => {
	for (let i = 0; i < times; i++) governor.settle();
};

const embedderRecording = (): {
	service: EmbeddingService;
	batches: number[];
	maxInFlight: () => number;
} => {
	const batches: number[] = [];
	let inFlight = 0;
	let peak = 0;
	return {
		batches,
		maxInFlight: () => peak,
		service: {
			dimensions: 3,
			embeddingId: "fake@3",
			embed: async (texts: string[]) => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				batches.push(texts.length);
				await Promise.resolve();
				inFlight -= 1;
				return texts.map(() => [0, 0, 0]);
			},
		},
	};
};

describe("the memory governor", () => {
	it("starts at the floor: the smallest batch, one inference", () => {
		const governor = new MemoryGovernor(CONFIG, harness(available(ROOMY)).deps);
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
	});

	it("ramps the batch first, then parallelism, while headroom holds", () => {
		const h = harness(available(ROOMY));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, CONFIG.rampAfterReadings);
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });
		settleTimes(governor, CONFIG.rampAfterReadings);
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 1 });
		settleTimes(governor, CONFIG.rampAfterReadings);
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 2 });
		assert.deepEqual(h.plans.at(-1), governor.plan);
	});

	it("makes a ramp cost several consecutive readings", () => {
		const h = harness(available(ROOMY));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, CONFIG.rampAfterReadings - 1);
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });
	});

	it("never ramps past the configured ceiling, and stops logging there", () => {
		const h = harness(available(ROOMY));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, 60);
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 2 });
		// One line per change of plan, not one per batch: three changes, three
		// lines, and nothing for the settles that changed nothing.
		assert.equal(h.lines.length, 3);
	});

	// The oscillation this exists to prevent: a box parked near the threshold,
	// ramping and shedding on alternate batches, logging every one of them.
	it("holds its plan while readings hover in the dead band", () => {
		const h = harness(reads(DEAD_BAND.map((mb) => ({ availableMb: mb }))));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, 30);
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
		assert.deepEqual(h.lines, []);
	});

	it("holds a ramped plan in the dead band too, rather than shedding it", () => {
		const script = [
			...Array(CONFIG.rampAfterReadings).fill({ availableMb: ROOMY }),
			...DEAD_BAND.map((mb) => ({ availableMb: mb })),
		];
		const h = harness(reads(script));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, CONFIG.rampAfterReadings);
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });

		settleTimes(governor, 30);
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });
		assert.equal(h.lines.length, 1);
	});

	// A shed cannot lower resident memory that onnxruntime's arena has already
	// claimed, so the ramp is gated on this process's own RSS as well: free
	// memory on the box is no licence to grow when the worker is already the
	// reason it might run out.
	it("never ramps while its own RSS is above the ceiling", () => {
		const h = harness(reads([{ availableMb: 8000, rssMb: 2000 }]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, 30);
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
	});

	it("sheds a ramped plan when its own RSS crosses the ceiling", () => {
		const script = [
			...Array(6).fill({ availableMb: ROOMY, rssMb: 512 }),
			{ availableMb: ROOMY, rssMb: 2000 },
		];
		const h = harness(reads(script));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, 6);
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 1 });
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });
	});

	it("halves the batch and drops to one inference when headroom goes", () => {
		const h = harness(available(ROOMY, ROOMY, ROOMY, 500));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, CONFIG.rampAfterReadings);
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
	});

	it("paces itself between batches once it has shed", async () => {
		const h = harness(available(ROOMY, ROOMY, ROOMY, 500));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, CONFIG.rampAfterReadings + 1);

		assert.equal(await governor.admit(), "admitted");
		assert.deepEqual(h.sleeps, [CONFIG.pauseMs]);
		// The pause is per shed, not sticky: an admit that follows no shed runs on.
		assert.equal(await governor.admit(), "admitted");
		assert.deepEqual(h.sleeps, [CONFIG.pauseMs]);
	});

	it("keeps pacing at the floor, where there is no smaller batch left", async () => {
		const h = harness(available(500));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
		assert.deepEqual(h.lines, []);
		assert.equal(await governor.admit(), "admitted");
		assert.deepEqual(h.sleeps, [CONFIG.pauseMs]);
	});

	it("stops and waits below the critical floor, then resumes", async () => {
		const h = harness(available(ROOMY, ROOMY, ROOMY, 300, 300, 1000));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		settleTimes(governor, CONFIG.rampAfterReadings);
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });

		assert.equal(await governor.admit(), "admitted");
		assert.equal(h.stalls, 1);
		assert.equal(h.sleeps.length, 2);
		// A stop is the loudest signal the worker has, and it comes back at the
		// floor rather than resuming at the size that emptied the box.
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
		assert.match(h.lines.at(-2) ?? "", /paused/);
		assert.match(h.lines.at(-1) ?? "", /resumed/);
	});

	// The poller's visibility timeout redelivers the record underneath a handler
	// that waits too long, so the wait ends first and says so.
	it("gives up once the stall budget is spent", async () => {
		const h = harness(available(300));
		const governor = new MemoryGovernor(CONFIG, h.deps);

		assert.equal(await governor.admit(), "expired");
		assert.equal(h.clock, CONFIG.stallMaxMs);
		assert.match(h.lines.at(-1) ?? "", /gave up/);
	});

	it("keeps the poll loop's heartbeat fresh while it waits", async () => {
		const h = harness(available(300));
		const governor = new MemoryGovernor(CONFIG, h.deps);

		await governor.admit();
		assert.equal(h.beats, CONFIG.stallMaxMs / CONFIG.pauseMs);
	});

	it("stays up when the heartbeat cannot be written", async () => {
		const h = harness(available(300));
		h.beatFails = true;
		const governor = new MemoryGovernor(CONFIG, h.deps);

		assert.equal(await governor.admit(), "expired");
		assert.ok(h.lines.some((line) => /heartbeat/.test(line)));
	});

	it("does not stall while the box is merely tight", async () => {
		const h = harness(available(500));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		assert.equal(await governor.admit(), "admitted");
		assert.equal(h.stalls, 0);
		assert.deepEqual(h.sleeps, []);
	});
});

describe("the governed embedder", () => {
	it("sends the floor batch first and returns every vector in order", async () => {
		const inner = embedderRecording();
		const h = harness(available(ROOMY));
		const service = createAdaptiveEmbeddingService(
			inner.service,
			new MemoryGovernor(CONFIG, h.deps),
		);
		const texts = Array.from({ length: 20 }, (_, i) => `chunk ${i}`);

		const vectors = await service.embed(texts);

		assert.equal(inner.batches[0], CONFIG.minBatchSize);
		assert.equal(
			inner.batches.reduce((sum, size) => sum + size, 0),
			texts.length,
		);
		assert.equal(vectors.length, texts.length);
	});

	it("never sends more than the configured maximum in one call", async () => {
		const inner = embedderRecording();
		const h = harness(available(ROOMY));
		const service = createAdaptiveEmbeddingService(
			inner.service,
			new MemoryGovernor(CONFIG, h.deps),
		);

		await service.embed(Array.from({ length: 500 }, (_, i) => `chunk ${i}`));

		assert.ok(Math.max(...inner.batches) <= CONFIG.maxBatchSize);
		assert.ok(inner.maxInFlight() <= CONFIG.maxConcurrency);
	});

	it("keeps one inference in flight on a box that never has headroom", async () => {
		const inner = embedderRecording();
		const h = harness(available(500));
		const service = createAdaptiveEmbeddingService(
			inner.service,
			new MemoryGovernor(CONFIG, h.deps),
		);

		await service.embed(Array.from({ length: 40 }, (_, i) => `chunk ${i}`));

		assert.deepEqual(new Set(inner.batches), new Set([CONFIG.minBatchSize]));
		assert.equal(inner.maxInFlight(), 1);
	});

	it("embeds nothing, and reads nothing, for an empty list", async () => {
		const inner = embedderRecording();
		let readCount = 0;
		const h = harness(() => {
			readCount += 1;
			return { rssBytes: 0, availableBytes: ROOMY * MB };
		});
		const service = createAdaptiveEmbeddingService(
			inner.service,
			new MemoryGovernor(CONFIG, h.deps),
		);

		assert.deepEqual(await service.embed([]), []);
		assert.deepEqual(inner.batches, []);
		assert.equal(readCount, 0);
	});

	it("passes the embedding identity through, so no index is invalidated", () => {
		const inner = embedderRecording();
		const service = createAdaptiveEmbeddingService(
			inner.service,
			new MemoryGovernor(CONFIG, harness(available(ROOMY)).deps),
		);
		assert.equal(service.embeddingId, inner.service.embeddingId);
		assert.equal(service.dimensions, inner.service.dimensions);
	});

	it("raises a stall timeout rather than embedding past the budget", async () => {
		const inner = embedderRecording();
		const h = harness(available(300));
		const service = createAdaptiveEmbeddingService(
			inner.service,
			new MemoryGovernor(CONFIG, h.deps),
			CONFIG.stallMaxMs,
		);

		await assert.rejects(
			() => service.embed(["one"]),
			(error: unknown) => error instanceof MemoryStallTimeoutError,
		);
		assert.deepEqual(inner.batches, []);
	});

	// The throttle paces work; it never turns a fault into a quiet retry.
	it("lets a model failure propagate", async () => {
		const h = harness(available(ROOMY));
		const service = createAdaptiveEmbeddingService(
			{
				dimensions: 3,
				embeddingId: "broken@3",
				embed: async () => {
					throw new Error("model could not be loaded");
				},
			},
			new MemoryGovernor(CONFIG, h.deps),
		);

		await assert.rejects(
			() => service.embed(["one"]),
			/model could not be loaded/,
		);
	});
});

const withEnv = (
	overrides: Record<string, string | undefined>,
	fn: () => void,
): void => {
	const saved: Record<string, string | undefined> = {};
	for (const key of Object.keys(overrides)) saved[key] = process.env[key];
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		fn();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
};

const UNSET = {
	SEARCH_INDEX_EMBED_BATCH_MIN: undefined,
	SEARCH_INDEX_EMBED_BATCH_MAX: undefined,
	SEARCH_INDEX_EMBED_CONCURRENCY_MAX: undefined,
	SEARCH_INDEX_EMBED_RAMP_AFTER: undefined,
	SEARCH_INDEX_MEMORY_HEADROOM_MB: undefined,
	SEARCH_INDEX_MEMORY_RAMP_MARGIN_MB: undefined,
	SEARCH_INDEX_RSS_CEILING_MB: undefined,
	SEARCH_INDEX_MEMORY_CRITICAL_MB: undefined,
	SEARCH_INDEX_MEMORY_PAUSE_MS: undefined,
	SEARCH_INDEX_MEMORY_STALL_MAX_MS: undefined,
};

describe("the configured thresholds", () => {
	it("defaults to the documented floor, ceiling and thresholds", () => {
		withEnv(UNSET, () => {
			assert.deepEqual(readAdaptiveEmbeddingConfigFromEnv(), {
				minBatchSize: 4,
				maxBatchSize: 32,
				maxConcurrency: 2,
				rampAfterReadings: 3,
				headroomBytes: 768 * MB,
				rampMarginBytes: 256 * MB,
				rssCeilingBytes: 1536 * MB,
				criticalBytes: 384 * MB,
				pauseMs: 2000,
				stallMaxMs: 240_000,
			});
		});
	});

	// The stall has to end before the queue redelivers the record underneath it.
	it("gives up well inside the poller's 300 s visibility timeout", () => {
		withEnv(UNSET, () => {
			assert.ok(readAdaptiveEmbeddingConfigFromEnv().stallMaxMs < 300_000);
		});
	});

	it("reads megabytes from the environment", () => {
		withEnv(
			{
				...UNSET,
				SEARCH_INDEX_MEMORY_HEADROOM_MB: "2048",
				SEARCH_INDEX_MEMORY_CRITICAL_MB: "1024",
				SEARCH_INDEX_RSS_CEILING_MB: "4096",
			},
			() => {
				const config = readAdaptiveEmbeddingConfigFromEnv();
				assert.equal(config.headroomBytes, 2048 * MB);
				assert.equal(config.criticalBytes, 1024 * MB);
				assert.equal(config.rssCeilingBytes, 4096 * MB);
			},
		);
	});

	it("refuses a critical floor at or above the ramp headroom", () => {
		withEnv(
			{
				...UNSET,
				SEARCH_INDEX_MEMORY_HEADROOM_MB: "512",
				SEARCH_INDEX_MEMORY_CRITICAL_MB: "512",
			},
			() => {
				assert.throws(
					readAdaptiveEmbeddingConfigFromEnv,
					/SEARCH_INDEX_MEMORY_CRITICAL_MB must be below/,
				);
			},
		);
	});

	it("refuses a floor batch above the ceiling", () => {
		withEnv(
			{
				...UNSET,
				SEARCH_INDEX_EMBED_BATCH_MIN: "64",
				SEARCH_INDEX_EMBED_BATCH_MAX: "32",
			},
			() => {
				assert.throws(
					readAdaptiveEmbeddingConfigFromEnv,
					/SEARCH_INDEX_EMBED_BATCH_MIN must not exceed/,
				);
			},
		);
	});

	it("refuses a value that is not a positive integer", () => {
		withEnv({ ...UNSET, SEARCH_INDEX_EMBED_BATCH_MAX: "0" }, () => {
			assert.throws(
				readAdaptiveEmbeddingConfigFromEnv,
				/SEARCH_INDEX_EMBED_BATCH_MAX must be a positive integer/,
			);
		});
	});
});
