// Reading npm's failures by their error code, and waiting out the one that
// passes on its own. A publish lands the version in the packument seconds before
// its tarball reaches every replica, so `npm view` can advertise a version that
// a pack a moment later answers with ETARGET. That window closes by itself; a
// version that was never published, or was unpublished, never becomes
// fetchable. So the wait is bounded and the last failure is raised as it stands
// — a persistent one still fails the run.

const errorText = (error) =>
	`${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;

export const isMissingPackage = (error) => errorText(error).includes("404");

export const isMissingVersion = (error) => errorText(error).includes("ETARGET");

export const PROPAGATION_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

// Every caller in the publish tool is synchronous, and a blocking wait on an
// Atomics timeout is the sleep that needs no callback.
const sleepSync = (ms) => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export const withVersionPropagation = (
	fetchVersion,
	{ delays = PROPAGATION_DELAYS_MS, sleep = sleepSync } = {},
) => {
	for (const delay of delays) {
		try {
			return fetchVersion();
		} catch (error) {
			if (!isMissingVersion(error)) throw error;
			sleep(delay);
		}
	}
	return fetchVersion();
};
