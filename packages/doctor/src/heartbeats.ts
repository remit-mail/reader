import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { attempt } from "./attempt.js";

/**
 * The age of a worker's stalest poll loop, read off the shared `heartbeat`
 * volume the workers write and this container mounts read-only (D1, D9).
 *
 * A worker runs one loop per queue and each rewrites its own
 * `<service>.<queue>` file, so the oldest of a service's files is the signal:
 * one loop wedged in a socket read while its siblings long-poll is exactly the
 * failure a container-wide timestamp would hide.
 */
export interface HeartbeatReading {
	readonly service: string;
	/** Seconds since the stalest of this service's files was written. */
	readonly ageSeconds: number | undefined;
	/** Why no age could be read. `undefined` when one was. */
	readonly error: string | undefined;
}

/**
 * A service with no file at all reads as an error, never as age zero. The whole
 * point of the volume is that the checker can look; a verdict computed from a
 * directory it could not read, or from a worker that has written nothing since
 * it started, must not come back healthy.
 */
export const readHeartbeats = async (
	directory: string,
	services: readonly string[],
	now: number = Date.now(),
): Promise<HeartbeatReading[]> => {
	const listing = await attempt(readdir(directory));
	if (!listing.ok) {
		const message = `cannot read ${directory}: ${listing.error}`;
		return services.map((service) => ({
			service,
			ageSeconds: undefined,
			error: message,
		}));
	}

	return Promise.all(
		services.map(async (service) => {
			const owned = listing.value.filter((name) =>
				name.startsWith(`${service}.`),
			);
			if (owned.length === 0) {
				return { service, ageSeconds: undefined, error: "no heartbeat file" };
			}
			const times = await attempt(
				Promise.all(
					owned.map(
						async (name) => (await stat(join(directory, name))).mtimeMs,
					),
				),
			);
			if (!times.ok) {
				return { service, ageSeconds: undefined, error: times.error };
			}
			return {
				service,
				ageSeconds: (now - Math.min(...times.value)) / 1000,
				error: undefined,
			};
		}),
	);
};
