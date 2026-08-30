import type { EmbeddingService } from "@remit/search-service";
import type { MemoryReader, MemoryReading } from "./memory.js";

/**
 * How much work the worker allows itself right now: how many chunk texts go
 * into one `embed` call, and how many such calls are in flight at once.
 */
export interface EmbeddingPlan {
	readonly batchSize: number;
	readonly concurrency: number;
}

export interface AdaptiveEmbeddingConfig {
	/** The plan the worker starts at and sheds back to. */
	readonly minBatchSize: number;
	readonly maxBatchSize: number;
	readonly maxConcurrency: number;
	/** Shed below this much free memory on the box. */
	readonly headroomBytes: number;
	/** Ramp only above `headroomBytes + rampMarginBytes`. */
	readonly rampMarginBytes: number;
	/** Consecutive comfortable readings a ramp costs. */
	readonly rampAfterReadings: number;
	/** Shed at or above this much resident memory in this process. */
	readonly rssCeilingBytes: number;
	/** Stop and wait while free memory on the box is below this. */
	readonly criticalBytes: number;
	/** Wait between batches after shedding, and between reads while stopped. */
	readonly pauseMs: number;
	/** Give the message back to the queue after stopping this long. */
	readonly stallMaxMs: number;
}

export interface GovernorLog {
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
	error(message: string, fields?: Record<string, unknown>): void;
}

export interface GovernorDeps {
	readonly readMemory: MemoryReader;
	readonly sleep: (ms: number) => Promise<void>;
	readonly now: () => number;
	readonly log: GovernorLog;
	/**
	 * The poll loop's own liveness file. A stop happens inside a handler, which
	 * is between two receives and so between two beats — without this the
	 * container's healthcheck reads a stall as a wedged loop.
	 */
	readonly beat?: () => Promise<void>;
	readonly onPlan?: (plan: EmbeddingPlan) => void;
	readonly onStall?: () => void;
}

const MB = 1024 * 1024;

export const DEFAULT_ADAPTIVE_EMBEDDING_CONFIG: AdaptiveEmbeddingConfig = {
	minBatchSize: 4,
	maxBatchSize: 32,
	maxConcurrency: 2,
	headroomBytes: 768 * MB,
	rampMarginBytes: 256 * MB,
	rampAfterReadings: 3,
	rssCeilingBytes: 1536 * MB,
	criticalBytes: 384 * MB,
	pauseMs: 2000,
	stallMaxMs: 240_000,
};

/**
 * Raised when the box stayed below the critical floor for the whole stall
 * budget. The handler already treats any throw from an upsert as a per-message
 * failure, which is exactly the wanted outcome: the record is reported as a
 * batch item failure and redelivered, rather than held past the queue's
 * visibility timeout while the process waits.
 */
export class MemoryStallTimeoutError extends Error {
	readonly code = "ERR_SEARCH_INDEX_MEMORY_STALL";
	constructor(waitedMs: number) {
		super(
			`Search index waited ${Math.round(waitedMs / 1000)}s for the box to ` +
				"free memory and gave up; the message goes back on the queue",
		);
		this.name = "MemoryStallTimeoutError";
	}
}

const positiveInt = (name: string, raw: string): number => {
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer, got: ${raw}`);
	}
	return parsed;
};

/** `fallback` is already in the target unit; `scale` converts the env value. */
const fromEnv = (name: string, fallback: number, scale = 1): number => {
	const raw = process.env[name];
	if (!raw) return fallback;
	return positiveInt(name, raw) * scale;
};

/**
 * Every threshold is an env var so the same image bounds itself against a 4 GB
 * VPS and a 32 GB box without a rebuild. A configuration that cannot hold —
 * a critical floor at or above the ramp headroom, a floor batch above the
 * ceiling — is a startup error, not something to correct silently at runtime.
 */
export const readAdaptiveEmbeddingConfigFromEnv =
	(): AdaptiveEmbeddingConfig => {
		const d = DEFAULT_ADAPTIVE_EMBEDDING_CONFIG;
		const config: AdaptiveEmbeddingConfig = {
			minBatchSize: fromEnv("SEARCH_INDEX_EMBED_BATCH_MIN", d.minBatchSize),
			maxBatchSize: fromEnv("SEARCH_INDEX_EMBED_BATCH_MAX", d.maxBatchSize),
			maxConcurrency: fromEnv(
				"SEARCH_INDEX_EMBED_CONCURRENCY_MAX",
				d.maxConcurrency,
			),
			rampAfterReadings: fromEnv(
				"SEARCH_INDEX_EMBED_RAMP_AFTER",
				d.rampAfterReadings,
			),
			headroomBytes: fromEnv(
				"SEARCH_INDEX_MEMORY_HEADROOM_MB",
				d.headroomBytes,
				MB,
			),
			rampMarginBytes: fromEnv(
				"SEARCH_INDEX_MEMORY_RAMP_MARGIN_MB",
				d.rampMarginBytes,
				MB,
			),
			rssCeilingBytes: fromEnv(
				"SEARCH_INDEX_RSS_CEILING_MB",
				d.rssCeilingBytes,
				MB,
			),
			criticalBytes: fromEnv(
				"SEARCH_INDEX_MEMORY_CRITICAL_MB",
				d.criticalBytes,
				MB,
			),
			pauseMs: fromEnv("SEARCH_INDEX_MEMORY_PAUSE_MS", d.pauseMs),
			stallMaxMs: fromEnv("SEARCH_INDEX_MEMORY_STALL_MAX_MS", d.stallMaxMs),
		};
		if (config.minBatchSize > config.maxBatchSize) {
			throw new Error(
				"SEARCH_INDEX_EMBED_BATCH_MIN must not exceed SEARCH_INDEX_EMBED_BATCH_MAX",
			);
		}
		if (config.criticalBytes >= config.headroomBytes) {
			throw new Error(
				"SEARCH_INDEX_MEMORY_CRITICAL_MB must be below SEARCH_INDEX_MEMORY_HEADROOM_MB",
			);
		}
		return config;
	};

type Admission = "admitted" | "expired";

/**
 * Bounds the worker's resident memory against the box it shares, which
 * `--max-old-space-size` cannot: the embedding model, its inference arenas and
 * its tensors are native allocations outside V8's old space (#585).
 *
 * It steers on two numbers, because neither is sufficient alone. The box's
 * `MemAvailable` says whether the rest of the stack still has room. This
 * process's own RSS says whether the worker is the reason it does not — and it
 * is the one a shed cannot walk back: onnxruntime sizes its CPU arena to the
 * largest batch it has ever run and does not hand that back, so a plan that
 * ramps on free memory alone raises a floor it can never lower. Above the RSS
 * ceiling the worker sheds and stays shed.
 *
 * Ramping costs several consecutive comfortable readings and needs a margin
 * above the shed threshold; shedding is immediate at it. Without that gap a box
 * sitting near the threshold — the ordinary steady state — would ramp and shed
 * on alternate batches, logging every one of them and halving throughput for
 * nothing.
 *
 * Below the critical floor it stops entirely rather than pushing the host into
 * swap, where the kernel picks its OOM victim by size and takes the backend
 * rather than the indexer. That stop is bounded: past the budget the message
 * goes back on the queue, because a handler that waits longer than the queue's
 * visibility timeout has its record redelivered underneath it anyway.
 */
export class MemoryGovernor {
	private batchSize: number;
	private concurrency = 1;
	private pauseBeforeNextBatch = false;
	private comfortableReadings = 0;

	constructor(
		private readonly config: AdaptiveEmbeddingConfig,
		private readonly deps: GovernorDeps,
	) {
		this.batchSize = config.minBatchSize;
	}

	get plan(): EmbeddingPlan {
		return { batchSize: this.batchSize, concurrency: this.concurrency };
	}

	/** Blocks until the box can afford the next batch, or the budget runs out. */
	admit = async (): Promise<Admission> => {
		let reading = this.deps.readMemory();
		if (reading.availableBytes >= this.config.criticalBytes) {
			if (!this.pauseBeforeNextBatch) return "admitted";
			this.pauseBeforeNextBatch = false;
			await this.deps.sleep(this.config.pauseMs);
			return "admitted";
		}

		this.deps.onStall?.();
		this.deps.log.warn(
			"Search index paused: the box is below the critical memory floor",
			this.fields(reading),
		);
		this.reset();
		const startedAt = this.deps.now();
		while (reading.availableBytes < this.config.criticalBytes) {
			const waitedMs = this.deps.now() - startedAt;
			if (waitedMs >= this.config.stallMaxMs) {
				this.deps.log.warn("Search index gave up waiting for memory", {
					waitedMs,
					...this.fields(reading),
				});
				return "expired";
			}
			await this.keepAlive();
			await this.deps.sleep(this.config.pauseMs);
			reading = this.deps.readMemory();
		}
		this.pauseBeforeNextBatch = false;
		this.deps.log.info(
			"Search index resumed: memory recovered",
			this.fields(reading),
		);
		return "admitted";
	};

	/** Measures what the batch just cost and moves the plan at most one step. */
	settle = (): void => {
		const reading = this.deps.readMemory();
		if (this.underPressure(reading)) {
			this.comfortableReadings = 0;
			this.shed(reading);
			return;
		}
		if (!this.roomToGrow(reading)) {
			this.comfortableReadings = 0;
			return;
		}
		this.comfortableReadings += 1;
		if (this.comfortableReadings < this.config.rampAfterReadings) return;
		this.comfortableReadings = 0;
		this.ramp(reading);
	};

	private underPressure(reading: MemoryReading): boolean {
		return (
			reading.rssBytes >= this.config.rssCeilingBytes ||
			reading.availableBytes < this.config.headroomBytes
		);
	}

	private roomToGrow(reading: MemoryReading): boolean {
		return (
			reading.rssBytes < this.config.rssCeilingBytes &&
			reading.availableBytes >=
				this.config.headroomBytes + this.config.rampMarginBytes
		);
	}

	// A write that fails must not take the worker down with it, for the same
	// reason the poll loop's own beat does not: a full disk is the likeliest
	// cause and the moment to stay up. The missed beat is itself the signal.
	private keepAlive = async (): Promise<void> => {
		await this.deps.beat?.().catch((error: unknown) => {
			this.deps.log.error("Search index heartbeat write failed", {
				error: String(error),
			});
		});
	};

	private shed(reading: MemoryReading): void {
		// Pacing applies whenever the box is tight, including at the floor, where
		// there is no smaller batch left to fall back to.
		this.pauseBeforeNextBatch = true;
		const batchSize = Math.max(
			this.config.minBatchSize,
			Math.floor(this.batchSize / 2),
		);
		if (batchSize === this.batchSize && this.concurrency === 1) return;
		this.batchSize = batchSize;
		this.concurrency = 1;
		this.announce("shed", reading);
	}

	private ramp(reading: MemoryReading): void {
		if (this.batchSize < this.config.maxBatchSize) {
			this.batchSize = Math.min(this.config.maxBatchSize, this.batchSize * 2);
		} else if (this.concurrency < this.config.maxConcurrency) {
			this.concurrency += 1;
		} else {
			return;
		}
		this.announce("ramp", reading);
	}

	private reset(): void {
		this.batchSize = this.config.minBatchSize;
		this.concurrency = 1;
		this.comfortableReadings = 0;
		this.deps.onPlan?.(this.plan);
	}

	// One line per change of plan, never one per batch: a first index is
	// hundreds of thousands of batches and a per-batch line is not a log.
	private announce(decision: "ramp" | "shed", reading: MemoryReading): void {
		this.deps.onPlan?.(this.plan);
		this.deps.log.info(`Search index embedding ${decision}`, {
			batchSize: this.batchSize,
			concurrency: this.concurrency,
			...this.fields(reading),
		});
	}

	private fields(reading: MemoryReading): Record<string, unknown> {
		return {
			availableMb: Math.round(reading.availableBytes / MB),
			rssMb: Math.round(reading.rssBytes / MB),
			headroomMb: Math.round(this.config.headroomBytes / MB),
			criticalMb: Math.round(this.config.criticalBytes / MB),
			rssCeilingMb: Math.round(this.config.rssCeilingBytes / MB),
		};
	}
}

/**
 * Wraps an embedder so its work passes through the governor. The whole text
 * list arrives as one call today (one email's chunks); this splits it into
 * governed batches and holds only the current wave's inputs, so the model's
 * outputs from a finished batch are unreachable before the next one starts.
 *
 * `dimensions` and `embeddingId` pass straight through: `embeddingId` feeds the
 * content hash that decides what needs re-embedding, so wrapping the embedder
 * must not invalidate an existing index.
 */
export const createAdaptiveEmbeddingService = (
	inner: EmbeddingService,
	governor: MemoryGovernor,
	stallMaxMs: number = DEFAULT_ADAPTIVE_EMBEDDING_CONFIG.stallMaxMs,
): EmbeddingService => ({
	dimensions: inner.dimensions,
	embeddingId: inner.embeddingId,
	embed: async (texts: string[]): Promise<number[][]> => {
		const vectors: number[][] = [];
		let next = 0;
		while (next < texts.length) {
			if ((await governor.admit()) === "expired") {
				throw new MemoryStallTimeoutError(stallMaxMs);
			}
			const { batchSize, concurrency } = governor.plan;
			const wave: string[][] = [];
			while (wave.length < concurrency && next < texts.length) {
				wave.push(texts.slice(next, next + batchSize));
				next += batchSize;
			}
			const embedded = await Promise.all(
				wave.map((batch) => inner.embed(batch)),
			);
			for (const batch of embedded) vectors.push(...batch);
			governor.settle();
		}
		return vectors;
	},
});
