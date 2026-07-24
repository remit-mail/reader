import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
export const DEFAULT_REGISTRY = "ghcr.io/remit-mail/reader";

// The SQLite migration sets the self-host stack applies, in the layout the
// migrate one-shot reads (deploy/vps/migrate/run-migrate.ts). Each set is a
// drizzle folder whose meta/_journal.json lists one entry per migration.
export const SQLITE_MIGRATION_SETS = ["auth", "entities", "meta"];

// Read from the schema source as text, not imported: this module runs in the
// install-free CI suite (npm-scripts/test-script-suites.mjs in ci.yml's
// validate job) where @remit/data-ports does not resolve as a package. Reading
// the exported constant keeps the single source of truth without that
// dependency — the same approach summary-check.sh takes.
function readSummaryMaxLength() {
	const schemaPath = join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"packages/data-ports/src/update-manifest.ts",
	);
	const source = readFileSync(schemaPath, "utf8");
	const match = source.match(/^export const SUMMARY_MAX_LENGTH = (\d+);$/m);
	if (!match) {
		throw new Error(`could not read SUMMARY_MAX_LENGTH from ${schemaPath}`);
	}
	return Number(match[1]);
}

const SUMMARY_MAX_LENGTH = readSummaryMaxLength();

// The release's schema version, derived from the migrations directory rather
// than authored: the sum of the drizzle journal entries across every SQLite
// migration set. A fully-migrated instance holds exactly one row per journal
// entry in the matching __drizzle_migrations_<set> table, so this number is the
// same count the wrapper reads back off the live database — schemaVersion >
// currentSchemaVersion is exactly "installing this release runs a migration". A
// hand-authored number drifts the moment a migration is added; this cannot.
export function deriveSchemaVersion(repoRoot) {
	let total = 0;
	for (const set of SQLITE_MIGRATION_SETS) {
		const journalPath = join(
			repoRoot,
			"deploy/vps/migrations-sqlite",
			set,
			"meta",
			"_journal.json",
		);
		const journal = JSON.parse(readFileSync(journalPath, "utf8"));
		if (!Array.isArray(journal.entries)) {
			throw new Error(`${journalPath} has no entries array`);
		}
		total += journal.entries.length;
	}
	return total;
}

export function assertValidVersion(version) {
	if (!RELEASE_TAG_PATTERN.test(version)) {
		throw new Error(`"${version}" is not a valid release tag; expected vX.Y.Z`);
	}
}

export function extractSummary(tagMessage) {
	const summary = tagMessage.split("\n")[0].trim();
	if (summary.length === 0) {
		throw new Error("the tag annotation message has no summary line");
	}
	if (summary.length > SUMMARY_MAX_LENGTH) {
		throw new Error(
			`the tag summary is ${summary.length} characters; the manifest allows at most ${SUMMARY_MAX_LENGTH}`,
		);
	}
	return summary;
}

export function readTagSummary(version, { execFile }) {
	let tagType;
	try {
		tagType = execFile("git", [
			"cat-file",
			"-t",
			`refs/tags/${version}`,
		]).trim();
	} catch (error) {
		throw new Error(`could not read the tag ${version}: ${error.message}`);
	}
	if (tagType !== "tag") {
		throw new Error(
			`${version} is a lightweight tag; an annotated tag is required so the summary is an authored message rather than the commit it happens to point at`,
		);
	}
	const contents = execFile("git", [
		"for-each-ref",
		"--format=%(contents:subject)",
		`refs/tags/${version}`,
	]);
	return extractSummary(contents);
}
