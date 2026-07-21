import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
export const DEFAULT_REGISTRY = "ghcr.io/remit-mail/reader";

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
