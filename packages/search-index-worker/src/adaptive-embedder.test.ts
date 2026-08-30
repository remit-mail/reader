import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EmbeddingService } from "@remit/search-service";
import {
	type AdaptiveEmbeddingConfig,
	createAdaptiveEmbeddingService,
	type EmbeddingPlan,
	type GovernorDeps,
	MemoryGovernor,
	readAdaptiveEmbeddingConfigFromEnv,
} from "./adaptive-embedder.js";
import type { MemoryReader } from "./memory.js";

const MB = 1024 * 1024;

const CONFIG: AdaptiveEmbeddingConfig = {
	minBatchSize: 2,
	maxBatchSize: 8,
	maxConcurrency: 2,
	headroomBytes: 768 * MB,
	criticalBytes: 384 * MB,
	pauseMs: 10,
};

/** Available megabytes, one entry per read; the last value repeats forever. */
const reads = (availableMb: readonly number[]): MemoryReader => {
	let next = 0;
	return () => {
		const mb = availableMb[Math.min(next, availableMb.length - 1)];
		next += 1;
		return { rssBytes: 512 * MB, availableBytes: mb * MB };
	};
};

class Harness {
	readonly plans: EmbeddingPlan[] = [];
	readonly sleeps: number[] = [];
	readonly lines: string[] = [];
	stalls = 0;
	readonly deps: GovernorDeps;

	constructor(readMemory: MemoryReader) {
		const record = (message: string) => {
			this.lines.push(message);
		};
		this.deps = {
			readMemory,
			sleep: async (ms) => {
				this.sleeps.push(ms);
			},
			log: { info: record, warn: record },
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
		const governor = new MemoryGovernor(CONFIG, harness(reads([2000])).deps);
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
	});

	it("ramps the batch first, then parallelism, while headroom holds", () => {
		const h = harness(reads([2000]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 1 });
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 2 });
		assert.deepEqual(h.plans.at(-1), governor.plan);
	});

	it("never ramps past the configured ceiling, and stops logging there", () => {
		const h = harness(reads([2000]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		for (let i = 0; i < 20; i++) governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 2 });
		// One line per change of plan, not one per batch: three changes, three
		// lines, and nothing for the seventeen settles that changed nothing.
		assert.equal(h.lines.length, 3);
	});

	it("halves the batch and drops to one inference when headroom goes", () => {
		const h = harness(reads([2000, 2000, 2000, 500]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		governor.settle();
		governor.settle();
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 2 });
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });
	});

	it("paces itself between batches once it has shed", async () => {
		const h = harness(reads([2000, 2000, 2000, 500]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		for (let i = 0; i < 4; i++) governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 4, concurrency: 1 });

		await governor.admit();
		assert.deepEqual(h.sleeps, [CONFIG.pauseMs]);
		// The pause is per shed, not sticky: an admit that follows no shed runs on.
		await governor.admit();
		assert.deepEqual(h.sleeps, [CONFIG.pauseMs]);
	});

	it("keeps pacing at the floor, where there is no smaller batch left", async () => {
		const h = harness(reads([500]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
		assert.deepEqual(h.lines, []);
		await governor.admit();
		assert.deepEqual(h.sleeps, [CONFIG.pauseMs]);
	});

	it("stops and waits below the critical floor, then resumes", async () => {
		const h = harness(reads([2000, 2000, 300, 300, 1000]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		governor.settle();
		governor.settle();
		assert.deepEqual(governor.plan, { batchSize: 8, concurrency: 1 });

		await governor.admit();
		assert.equal(h.stalls, 1);
		assert.equal(h.sleeps.length, 2);
		// A stop is the loudest signal the worker has, and it comes back at the
		// floor rather than resuming at the size that emptied the box.
		assert.deepEqual(governor.plan, { batchSize: 2, concurrency: 1 });
		assert.match(h.lines.at(-2) ?? "", /paused/);
		assert.match(h.lines.at(-1) ?? "", /resumed/);
	});

	it("does not stall while the box is merely tight", async () => {
		const h = harness(reads([500]));
		const governor = new MemoryGovernor(CONFIG, h.deps);
		await governor.admit();
		assert.equal(h.stalls, 0);
		assert.deepEqual(h.sleeps, []);
	});
});

describe("the governed embedder", () => {
	it("sends the floor batch first and returns every vector in order", async () => {
		const inner = embedderRecording();
		const h = harness(reads([2000]));
		const service = createAdaptiveEmbeddingService(
			inner.service,
			new MemoryGovernor(CONFIG, h.deps),
		);
		const texts = Array.from({ length: 20 }, (_, i) => `chunk ${i}`);

		const vectors = await service.embed(texts);

		assert.equal(inner.batches[0], CONFIG.minBatchSize);
		assert.deepEqual(inner.batches, [2, 4, 8, 6]);
		assert.equal(vectors.length, texts.length);
	});

	it("never sends more than the configured maximum in one call", async () => {
		const inner = embedderRecording();
		const h = harness(reads([2000]));
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
		const h = harness(reads([500]));
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
			return { rssBytes: 0, availableBytes: 2000 * MB };
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
			new MemoryGovernor(CONFIG, harness(reads([2000])).deps),
		);
		assert.equal(service.embeddingId, inner.service.embeddingId);
		assert.equal(service.dimensions, inner.service.dimensions);
	});

	// The throttle paces work; it never turns a fault into a quiet retry.
	it("lets a model failure propagate", async () => {
		const h = harness(reads([2000]));
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

describe("the configured thresholds", () => {
	it("defaults to the documented floor, ceiling and thresholds", () => {
		withEnv(
			{
				SEARCH_INDEX_EMBED_BATCH_MIN: undefined,
				SEARCH_INDEX_EMBED_BATCH_MAX: undefined,
				SEARCH_INDEX_EMBED_CONCURRENCY_MAX: undefined,
				SEARCH_INDEX_MEMORY_HEADROOM_MB: undefined,
				SEARCH_INDEX_MEMORY_CRITICAL_MB: undefined,
				SEARCH_INDEX_MEMORY_PAUSE_MS: undefined,
			},
			() => {
				assert.deepEqual(readAdaptiveEmbeddingConfigFromEnv(), {
					minBatchSize: 4,
					maxBatchSize: 32,
					maxConcurrency: 2,
					headroomBytes: 768 * MB,
					criticalBytes: 384 * MB,
					pauseMs: 2000,
				});
			},
		);
	});

	it("reads megabytes from the environment", () => {
		withEnv(
			{
				SEARCH_INDEX_MEMORY_HEADROOM_MB: "2048",
				SEARCH_INDEX_MEMORY_CRITICAL_MB: "1024",
			},
			() => {
				const config = readAdaptiveEmbeddingConfigFromEnv();
				assert.equal(config.headroomBytes, 2048 * MB);
				assert.equal(config.criticalBytes, 1024 * MB);
			},
		);
	});

	it("refuses a critical floor at or above the ramp headroom", () => {
		withEnv(
			{
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
		withEnv({ SEARCH_INDEX_EMBED_BATCH_MAX: "0" }, () => {
			assert.throws(
				readAdaptiveEmbeddingConfigFromEnv,
				/SEARCH_INDEX_EMBED_BATCH_MAX must be a positive integer/,
			);
		});
	});
});
