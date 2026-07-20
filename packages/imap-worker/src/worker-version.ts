/**
 * The build of this worker, stamped onto a quarantine record so a maintainer
 * reading a filed report knows which commit failed to read the message.
 *
 * Deliberately not the client's `APP_SHA`: that is the web build, and pointing
 * a maintainer at it for a backend parse failure sends them to the wrong
 * commit. The container bundle replaces this read at build time (see
 * `npm-scripts/docker-bundle.mjs`); outside an image build it falls back to the
 * CI-provided SHA, then to `dev`, so a local run is labelled honestly rather
 * than claiming a release it is not.
 */
export const workerVersion = (): string =>
	process.env.REMIT_WORKER_SHA || process.env.GITHUB_SHA || "dev";
