import { writeFile } from "node:fs/promises";

/**
 * Poll-loop liveness as a file (docs/design/standalone-observability.md, D1).
 *
 * A worker whose poll loop wedges inside a socket read never exits, so
 * `restart: unless-stopped` never fires and `docker compose ps` reports it
 * running while mail stops moving. The loop rewrites this file once per receive
 * attempt; a container healthcheck reads its age and fails when it exceeds a
 * threshold above the longest legitimate handler run.
 *
 * A file rather than an HTTP route because an HTTP handler answers from a
 * process whose poll loop is wedged — any honest health endpoint would have to
 * consult this same timestamp.
 *
 * The heartbeat proves the loop is turning, not that the last unit of work
 * succeeded. A worker that receives, fails every handler and rewrites the file
 * each cycle is healthy here.
 */
export type Heartbeat = () => Promise<void>;

const noHeartbeat: Heartbeat = () => Promise.resolve();

/**
 * `WORKER_HEARTBEAT_FILE` is set per worker service by the self-host compose
 * stack, which owns both the path and the volume it lands on. Unset — the
 * Lambda deployment, where the poller does not run at all, and any local
 * process — writes nothing.
 *
 * The written value is the timestamp itself, so the file is readable as well as
 * stat-able: an empty rewrite is not guaranteed to advance mtime when the file
 * is already zero-length, and mtime is the whole signal.
 */
export const createHeartbeat = (
	filePath: string | undefined = process.env.WORKER_HEARTBEAT_FILE,
): Heartbeat => {
	if (!filePath) return noHeartbeat;
	return () => writeFile(filePath, `${new Date().toISOString()}\n`);
};
