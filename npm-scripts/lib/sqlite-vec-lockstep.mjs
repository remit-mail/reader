/**
 * The sqlite-vec version the musl build compiles has to be the one the
 * search-index-worker's manifest pins — and that pin has to be exact and
 * lockfile-resolved.
 *
 * The search-index-worker writes vectors through the npm `sqlite-vec` package
 * (glibc, node:24-slim) and the backend reads the same vec.db through a
 * `vec0.so` the Dockerfile compiles from the amalgamation against musl. One
 * file format, two builds. The Dockerfile takes its version from the worker's
 * runtime package.json rather than a pin of its own (#261), so the two cannot
 * drift apart at the version level; what can still go wrong is the wiring (a
 * second pin reintroduced, the manifest no longer copied or read) and the
 * manifest itself (a range, or a lockfile that resolves something else —
 * `npm ci` installs the lockfile, so that is the version the worker image
 * runs while the musl stage compiles the manifest's pin).
 *
 * Read as text rather than resolved: this runs in the install-free npm-scripts
 * suite, where node_modules is not there to ask.
 */

const INDEPENDENT_ARG_PATTERN = /^ARG SQLITE_VEC_VERSION=/m;
const COPY_MANIFEST_PATTERN = /^COPY (\S+package\.json) \S+$/m;
const PIN_READ_PATTERN = /jq -r '\.dependencies\["sqlite-vec"\]'/;
const NPM_RANGE_PREFIX = /^[\^~]/;

/** The `sqlite-vec-musl` stage's text, or a throw naming the missing stage. */
const stageText = (dockerfile) => {
	const start = dockerfile.search(/^FROM .* AS sqlite-vec-musl$/m);
	if (start === -1) {
		throw new Error(
			"the Dockerfile declares no sqlite-vec-musl stage; that stage's vec0.so is what the backend reads vec.db with",
		);
	}
	const end = dockerfile.indexOf("\nFROM ", start + 1);
	return end === -1 ? dockerfile.slice(start) : dockerfile.slice(start, end);
};

/**
 * The manifest the musl build reads its version from, or a throw saying why
 * the derivation is not there. A returned path is a claim, not a fact: the
 * caller decides whether that manifest is the one the worker image installs.
 */
export const readDockerfilePinSource = (dockerfile) => {
	const stage = stageText(dockerfile);
	if (INDEPENDENT_ARG_PATTERN.test(stage)) {
		throw new Error(
			"the sqlite-vec-musl stage declares its own ARG SQLITE_VEC_VERSION; the musl build takes its version from the search-index-worker's manifest, and a second pin is exactly the silent drift #261 is about",
		);
	}
	const copy = stage.match(COPY_MANIFEST_PATTERN);
	if (!copy) {
		throw new Error(
			"the sqlite-vec-musl stage copies no package.json; the amalgamation it compiles has to take its version from the search-index-worker's manifest, not a pin of its own",
		);
	}
	if (!PIN_READ_PATTERN.test(stage)) {
		throw new Error(
			'the sqlite-vec-musl stage never reads .dependencies["sqlite-vec"] out of the manifest it copies; the version has to come from there',
		);
	}
	return copy[1];
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
 * Why the one pin is not safe to ship, or nothing. A range rather than an
 * exact version is its own finding: the musl stage's sha256 is hand-pinned to
 * one tarball and its build guard rejects anything but an exact pin, so a
 * range fails the image build — loudly, but only once someone builds it. A
 * lockfile that resolves something else is quieter and worse: the worker
 * image `npm ci`s the lockfile while the musl stage compiles the manifest's
 * pin, so the two images run apart with nothing failing at build time.
 */
export const findVersionDivergence = ({ workerPin, workerLockVersion }) => {
	if (NPM_RANGE_PREFIX.test(workerPin)) {
		return `the search-index-worker pins sqlite-vec as the range "${workerPin}", but the Dockerfile's musl stage reads that same manifest and its sha256 covers exactly one tarball. Pin it exactly.`;
	}
	if (workerLockVersion !== undefined && workerLockVersion !== workerPin) {
		return `the search-index-worker asks for sqlite-vec ${workerPin} and its lockfile resolves ${workerLockVersion}. The worker image is built with \`npm ci\`, so the lockfile is what it runs — while the musl stage compiles the manifest's ${workerPin}. One index, two builds: they have to be the same version.`;
	}
	return null;
};
