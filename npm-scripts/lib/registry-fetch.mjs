// Reading npm's failures by their error code, and waiting out the one that
// passes on its own. A publish lands the version in the packument seconds before
// its tarball reaches every replica, so `npm view` can advertise a version that
// a pack a moment later answers with ETARGET. That window closes by itself; a
// version that was never published, or was unpublished, never becomes
// fetchable. So the wait is bounded and the last failure is raised as it stands
// — a persistent one still fails the run.

const errorText = (error) =>
	`${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;

// npm closes every failure with the path to its debug log, whose millisecond
// field is `404` about one run in a thousand. Only npm's own code line and its
// numbered error line say the package is absent.
const MISSING_PACKAGE = /\bE404\b|npm error 404\b/;

export const isMissingPackage = (error) =>
	MISSING_PACKAGE.test(errorText(error));

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
