import { readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Poll-loop liveness as a file (docs/design/standalone-observability.md, D1).
 *
 * A worker whose poll loop wedges inside a socket read never exits, so
 * `restart: unless-stopped` never fires and `docker compose ps` reports it
 * running while mail stops moving. Each loop rewrites its own file once per
 * receive attempt; a container healthcheck reads the age of the oldest of them
 * and fails past a threshold above the longest legitimate handler run.
 *
 * One file per loop, not one per container: a worker runs a loop per queue, and
 * a receive loop only ever talks to the queue sidecar. One handler wedged in an
 * IMAP read leaves imap-worker's other five loops long-polling, so a
 * container-wide file stays fresh through exactly the failure this exists to
 * catch. One writer per file also means a reader cannot catch a torn write.
 *
 * A file rather than an HTTP route because an HTTP handler answers from a
 * process whose poll loop is wedged — any honest health endpoint would have to
 * consult this same timestamp.
 *
 * The heartbeat proves the loop is turning, not that the last unit of work
 * succeeded. A loop that receives, fails every handler and rewrites its file
 * each cycle is healthy here.
 */
export type Heartbeat = () => Promise<void>;

const noHeartbeat: Heartbeat = () => Promise.resolve();

/**
 * `WORKER_HEARTBEAT_PREFIX` is set per worker service by the self-host compose
 * stack, which owns both the path and the volume it lands on; each loop appends
 * its own queue name. Unset — the Lambda deployment, where the poller does not
 * run at all, and any local process — writes nothing.
 *
 * The written value is the timestamp itself, so the file is readable as well as
 * stat-able: an empty rewrite is not guaranteed to advance mtime when the file
 * is already zero-length, and mtime is the whole signal.
 */
export const createHeartbeat = (
	name: string,
	prefix: string | undefined = process.env.WORKER_HEARTBEAT_PREFIX,
): Heartbeat => {
	if (!prefix) return noHeartbeat;
	const filePath = `${prefix}.${name}`;
	return () => writeFile(filePath, `${new Date().toISOString()}\n`);
};

/**
 * Drops the files this service left on the volume, before its loops start
 * writing again. The healthcheck fails on the oldest file it finds, so a queue
 * a later version stops polling would otherwise leave a file nobody rewrites,
 * and a worker that can never report healthy again.
 */
export const clearHeartbeats = async (
	prefix: string | undefined = process.env.WORKER_HEARTBEAT_PREFIX,
): Promise<void> => {
	if (!prefix) return;
	const directory = dirname(prefix);
	const owned = `${basename(prefix)}.`;
	const names = await readdir(directory);
	await Promise.all(
		names
			.filter((name) => name.startsWith(owned))
			.map((name) => rm(join(directory, name))),
	);
};
