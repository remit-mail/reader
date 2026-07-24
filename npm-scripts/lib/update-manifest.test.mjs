import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertValidVersion,
	DEFAULT_REGISTRY,
	deriveReleaseNotesUrl,
	deriveSchemaVersion,
	extractSummary,
	REPO_SLUG,
	readTagSummary,
	SQLITE_MIGRATION_SETS,
} from "./update-manifest.mjs";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(scriptsDir, "..");

describe("assertValidVersion", () => {
	it("accepts vX.Y.Z", () => {
		assert.doesNotThrow(() => assertValidVersion("v1.5.0"));
	});

	it("rejects a version without the v prefix", () => {
		assert.throws(() => assertValidVersion("1.5.0"));
	});

	it("rejects a partial version", () => {
		assert.throws(() => assertValidVersion("v1.5"));
	});

	it("rejects a pre-release suffix", () => {
		assert.throws(() => assertValidVersion("v1.5.0-rc1"));
	});
});

describe("extractSummary", () => {
	it("takes the first line of the tag message", () => {
		assert.equal(
			extractSummary("Faster search.\n\nSome trailer nobody reads."),
			"Faster search.",
		);
	});

	it("trims surrounding whitespace", () => {
		assert.equal(extractSummary("  Faster search.  \n"), "Faster search.");
	});

	it("refuses an empty message", () => {
		assert.throws(() => extractSummary(""), /no summary line/);
	});

	it("refuses a message that is only whitespace", () => {
		assert.throws(() => extractSummary("   \n\n"), /no summary line/);
	});

	it("accepts a summary at exactly 140 characters", () => {
		const summary = "x".repeat(140);
		assert.equal(extractSummary(summary), summary);
	});

	it("refuses a summary over 140 characters", () => {
		assert.throws(() => extractSummary("x".repeat(141)), /at most 140/);
	});
});

describe("readTagSummary", () => {
	it("reads the summary from an annotated tag", () => {
		const execFile = (_cmd, args) => {
			if (args[0] === "cat-file") return "tag";
			if (args[0] === "for-each-ref") return "Faster search.\n";
			throw new Error(`unexpected git invocation: ${args.join(" ")}`);
		};
		assert.equal(readTagSummary("v1.5.0", { execFile }), "Faster search.");
	});

	it("refuses a lightweight tag without reading its contents", () => {
		let readContents = false;
		const execFile = (_cmd, args) => {
			if (args[0] === "cat-file") return "commit";
			readContents = true;
			return "some commit subject";
		};
		assert.throws(
			() => readTagSummary("v1.5.0", { execFile }),
			/lightweight tag/,
		);
		assert.equal(readContents, false);
	});

	it("wraps a missing ref as a readable error", () => {
		const execFile = () => {
			throw new Error("fatal: not a valid object name");
		};
		assert.throws(
			() => readTagSummary("v9.9.9", { execFile }),
			/could not read the tag v9\.9\.9/,
		);
	});
});

describe("deriveSchemaVersion", () => {
	it("sums the drizzle journal entries across every sqlite migration set", () => {
		const expected = SQLITE_MIGRATION_SETS.reduce((sum, set) => {
			const journal = JSON.parse(
				readFileSync(
					join(
						repoRoot,
						"deploy/vps/migrations-sqlite",
						set,
						"meta",
						"_journal.json",
					),
					"utf8",
				),
			);
			return sum + journal.entries.length;
		}, 0);
		assert.equal(deriveSchemaVersion(repoRoot), expected);
		// One migration per set at least, so the count clears the set count.
		assert.ok(deriveSchemaVersion(repoRoot) >= SQLITE_MIGRATION_SETS.length);
	});

	it("throws rather than guessing when a set's journal is missing", () => {
		assert.throws(() => deriveSchemaVersion("/no/such/repo/root"));
	});
});

describe("DEFAULT_REGISTRY", () => {
	it("matches the registry images-publish.sh defaults to", () => {
		const script = readFileSync(join(scriptsDir, "images-publish.sh"), "utf8");
		const [, registry] =
			script.match(/REGISTRY="\$\{REGISTRY:-([^}]+)\}"/) ?? [];
		assert.equal(DEFAULT_REGISTRY, registry);
	});
});

describe("deriveReleaseNotesUrl", () => {
	it("builds the tag URL from the version", () => {
		assert.equal(
			deriveReleaseNotesUrl("v1.5.0"),
			`https://github.com/${REPO_SLUG}/releases/tag/v1.5.0`,
		);
	});

	// The regression this guards: release.yml writes the manifest while the
	// release is still a draft, so the release object's html_url is GitHub's
	// untagged- placeholder. The URL must come from the tag, never that field.
	it("never carries a draft's untagged- URL", () => {
		const url = deriveReleaseNotesUrl("v0.1.0");
		assert.ok(!url.includes("untagged-"));
		assert.equal(
			url,
			"https://github.com/remit-mail/reader/releases/tag/v0.1.0",
		);
	});
});
