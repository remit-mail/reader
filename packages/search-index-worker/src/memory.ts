import { readFileSync } from "node:fs";

/**
 * What the governor steers on. `rssBytes` is this process's whole resident set,
 * which is the number that matters here: the embedding model, its inference
 * arenas and its per-batch tensors are allocated by onnxruntime's addon, so
 * none of them appear in the V8 heap and none are bounded by
 * `--max-old-space-size`. `availableBytes` is the box's, not the container's —
 * a container with no `mem_limit` reads the host's `/proc/meminfo`, which is
 * exactly the quantity a first index must not exhaust.
 */
export interface MemoryReading {
	rssBytes: number;
	availableBytes: number;
}

export type MemoryReader = () => MemoryReading;

const MEMINFO_PATH = "/proc/meminfo";

/**
 * `MemAvailable`, not `MemFree`: free memory excludes reclaimable page cache and
 * reads near zero on any box that has been up a while, which would stall the
 * worker permanently. `MemAvailable` is the kernel's own estimate of what a new
 * allocation can take without swapping.
 */
export const parseMemAvailableBytes = (meminfo: string): number => {
	const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
	if (!match) {
		throw new Error(`${MEMINFO_PATH} has no MemAvailable line`);
	}
	return Number(match[1]) * 1024;
};

export const readSystemMemory: MemoryReader = () => ({
	rssBytes: process.memoryUsage().rss,
	availableBytes: parseMemAvailableBytes(readFileSync(MEMINFO_PATH, "utf8")),
});
