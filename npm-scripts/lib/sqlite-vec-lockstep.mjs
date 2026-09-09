/**
 * The two sqlite-vec versions this repository pins have to be one version.
 *
 * The search-index-worker writes vectors through the npm `sqlite-vec` package
 * (glibc, node:24-slim) and the backend reads the same vec.db through a
 * `vec0.so` the Dockerfile compiles from the amalgamation against musl. One
 * file format, two builds, two independent pins: nothing fails when either
 * moves, and a divergence is a reader and a writer disagreeing about the
 * on-disk shape of the index (#261).
 *
 * Read as text rather than resolved: this runs in the install-free npm-scripts
 * suite, where node_modules is not there to ask.
 */

const ARG_PATTERN = /^ARG SQLITE_VEC_VERSION=(\S+)\s*$/m;
const NPM_RANGE_PREFIX = /^[\^~]/;

/** The version the backend image compiles, from the Dockerfile's build ARG. */
export const readDockerfileVersion = (dockerfile) => {
	const match = dockerfile.match(ARG_PATTERN);
	if (!match) {
		throw new Error(
			"the Dockerfile declares no ARG SQLITE_VEC_VERSION; the musl vec0.so build is what the backend reads vec.db with",
		);
	}
	return match[1];
};

/** The version the worker image installs, from its runtime package.json. */
export const readWorkerVersion = (packageJson) => {
	const manifest = JSON.parse(packageJson);
	const pin = manifest.dependencies?.["sqlite-vec"];
	if (typeof pin !== "string" || pin.length === 0) {
		throw new Error(
			"the search-index-worker runtime package.json pins no sqlite-vec; that package is what writes every vector",
		);
	}
	return pin;
};

/** The version the worker image actually installs, from its committed lockfile. */
export const readWorkerLockVersion = (packageLock) => {
	const lock = JSON.parse(packageLock);
	const entry = lock.packages?.["node_modules/sqlite-vec"];
	if (typeof entry?.version !== "string") {
		throw new Error(
			"the search-index-worker lockfile resolves no sqlite-vec; `npm ci` installs the lockfile, so that is the version the image runs",
		);
	}
	return entry.version;
};

/**
 * Why the pins disagree, or nothing. A range rather than an exact version is
 * its own finding: `^0.1.9` installs 0.1.10 the day it is published, while the
 * amalgamation the backend compiles stays where it was pinned — so the two
 * would be in lockstep today and silently apart on the next image build.
 */
export const findVersionDivergence = ({
	dockerfileVersion,
	workerPin,
	workerLockVersion,
}) => {
	if (NPM_RANGE_PREFIX.test(workerPin)) {
		return `the search-index-worker pins sqlite-vec as the range "${workerPin}", so the version it installs can move away from the Dockerfile's ${dockerfileVersion} without any change to this repository. Pin it exactly.`;
	}
	if (workerLockVersion !== undefined && workerLockVersion !== workerPin) {
		return `the search-index-worker asks for sqlite-vec ${workerPin} and its lockfile resolves ${workerLockVersion}. The image is built with \`npm ci\`, so the lockfile is what it runs.`;
	}
	if (workerPin !== dockerfileVersion) {
		return `sqlite-vec is ${dockerfileVersion} in the Dockerfile (the musl vec0.so the backend reads vec.db with) and ${workerPin} in the search-index-worker image (the package that writes it). One index, two builds: they have to be the same version.`;
	}
	return null;
};
