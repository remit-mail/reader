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
	/** Ramp only while `MemAvailable` stays above this. */
	readonly headroomBytes: number;
	/** Stop and wait while `MemAvailable` is below this. */
	readonly criticalBytes: number;
	/** Wait between batches after shedding, and between reads while stopped. */
	readonly pauseMs: number;
}

export interface GovernorLog {
	info(message: string, fields?: Record<string, unknown>): void;
	warn(message: string, fields?: Record<string, unknown>): void;
}

export interface GovernorDeps {
	readonly readMemory: MemoryReader;
	readonly sleep: (ms: number) => Promise<void>;
	readonly log: GovernorLog;
	readonly onPlan?: (plan: EmbeddingPlan) => void;
	readonly onStall?: () => void;
}

const MB = 1024 * 1024;

export const DEFAULT_ADAPTIVE_EMBEDDING_CONFIG: AdaptiveEmbeddingConfig = {
	minBatchSize: 4,
	maxBatchSize: 32,
	maxConcurrency: 2,
	headroomBytes: 768 * MB,
	criticalBytes: 384 * MB,
	pauseMs: 2000,
};

const positiveInt = (name: string, raw: string): number => {
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer, got: ${raw}`);
	}
	return parsed;
};

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
		const config: AdaptiveEmbeddingConfig = {
			minBatchSize: fromEnv(
				"SEARCH_INDEX_EMBED_BATCH_MIN",
				DEFAULT_ADAPTIVE_EMBEDDING_CONFIG.minBatchSize,
			),
			maxBatchSize: fromEnv(
				"SEARCH_INDEX_EMBED_BATCH_MAX",
				DEFAULT_ADAPTIVE_EMBEDDING_CONFIG.maxBatchSize,
			),
			maxConcurrency: fromEnv(
				"SEARCH_INDEX_EMBED_CONCURRENCY_MAX",
				DEFAULT_ADAPTIVE_EMBEDDING_CONFIG.maxConcurrency,
			),
			headroomBytes: fromEnv(
				"SEARCH_INDEX_MEMORY_HEADROOM_MB",
				DEFAULT_ADAPTIVE_EMBEDDING_CONFIG.headroomBytes / MB,
				MB,
			),
			criticalBytes: fromEnv(
				"SEARCH_INDEX_MEMORY_CRITICAL_MB",
				DEFAULT_ADAPTIVE_EMBEDDING_CONFIG.criticalBytes / MB,
				MB,
			),
			pauseMs: fromEnv(
				"SEARCH_INDEX_MEMORY_PAUSE_MS",
				DEFAULT_ADAPTIVE_EMBEDDING_CONFIG.pauseMs,
			),
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

/**
 * Bounds the worker's resident memory against the box it shares, which
 * `--max-old-space-size` cannot: the embedding model, its arenas and its
 * tensors are native allocations outside V8's old space (#585).
 *
 * It starts at the floor — the smallest batch, one inference — and ramps only
 * on measured headroom, so a first index of a large mailbox uses a big box
 * fully and crawls on a small one instead of taking the box down. Under
 * pressure it halves the batch, drops back to one inference and paces itself;
 * below the critical floor it stops entirely and waits rather than pushing the
 * host into swap, where the kernel's OOM killer picks a victim by size and
 * takes the backend rather than the indexer.
 */
export class MemoryGovernor {
	private batchSize: number;
	private concurrency = 1;
	private pauseBeforeNextBatch = false;

	constructor(
		private readonly config: AdaptiveEmbeddingConfig,
		private readonly deps: GovernorDeps,
	) {
		this.batchSize = config.minBatchSize;
	}

	get plan(): EmbeddingPlan {
		return { batchSize: this.batchSize, concurrency: this.concurrency };
	}

	/** Blocks until the box can afford the next batch. */
	admit = async (): Promise<void> => {
		let reading = this.deps.readMemory();
		if (reading.availableBytes >= this.config.criticalBytes) {
			if (!this.pauseBeforeNextBatch) return;
			this.pauseBeforeNextBatch = false;
			await this.deps.sleep(this.config.pauseMs);
			return;
		}

		this.deps.onStall?.();
		this.deps.log.warn(
			"Search index paused: the box is below the critical memory floor",
			this.fields(reading),
		);
		this.reset();
		while (reading.availableBytes < this.config.criticalBytes) {
			await this.deps.sleep(this.config.pauseMs);
			reading = this.deps.readMemory();
		}
		this.pauseBeforeNextBatch = false;
		this.deps.log.info(
			"Search index resumed: memory recovered",
			this.fields(reading),
		);
	};

	/** Measures what the batch just cost and moves the plan one step. */
	settle = (): void => {
		const reading = this.deps.readMemory();
		if (reading.availableBytes < this.config.headroomBytes) {
			this.shed(reading);
			return;
		}
		this.ramp(reading);
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
): EmbeddingService => ({
	dimensions: inner.dimensions,
	embeddingId: inner.embeddingId,
	embed: async (texts: string[]): Promise<number[][]> => {
		const vectors: number[][] = [];
		let next = 0;
		while (next < texts.length) {
			await governor.admit();
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
