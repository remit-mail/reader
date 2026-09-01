// `remit config save` (issue #1021, guard corrected in #1032).
//
// The file this command writes is the safety net an operator takes before
// dropping their database, so the only outcome that matters is the one where a
// damaged export is renamed into place anyway: the damage is discovered on the
// import that needed it and there is nothing left to import. What the export
// prints and what the parse says about it are therefore separate scenarios
// here, because exit 0 from the export is not evidence about the document.
//
// Driven against the same docker stand-in the doctor and update suites use.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const REMIT = join(ROOT, "deploy", "vps", "remit");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");
const FAKES = join(HERE, "remit-test");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const DOCUMENT = `${JSON.stringify(
	{
		version: 1,
		writtenBy: "v1.0.0",
		accounts: [{ address: "someone@example.com", folders: ["INBOX"] }],
	},
	null,
	"\t",
)}\n`;

const LOG_LINE = "[queue] connected to sqs-elasticmq after 3 attempts";

/**
 * @param {{ output?: string, exportExit?: number, parse?: string }} options
 */
function sandbox({ output = DOCUMENT, exportExit = 0, parse = "ok" } = {}) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-config-save-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const fake = join(dir, "fake");
	const bin = join(dir, "bin");
	const out = join(dir, "out");
	for (const d of [deployment, fake, bin, out])
		mkdirSync(d, { recursive: true });

	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	writeFileSync(join(deployment, ".env"), "REMIT_TAG=v1.0.0\n");
	writeFileSync(join(fake, "run-out"), output);
	writeFileSync(
		join(fake, "scenario"),
		[`run_exit=${exportExit}`, `parse=${parse}`, ""].join("\n"),
	);

	const dest = join(bin, "docker");
	copyFileSync(join(FAKES, "fake-docker.sh"), dest);
	spawnSync("chmod", ["+x", dest]);

	const target = join(out, "reader-config.json");
	return {
		target,
		run(args) {
			return spawnSync("sh", [REMIT, "config", "save", target, ...args], {
				env: {
					PATH: `${bin}:${process.env.PATH}`,
					HOME: dir,
					FAKE_DOCKER_DIR: fake,
					REMIT_DIR: deployment,
				},
				encoding: "utf8",
			});
		},
		written() {
			return existsSync(target) ? readFileSync(target, "utf8") : null;
		},
		leftovers() {
			return readdirSync(out).filter((name) => name.includes(".writing."));
		},
		log() {
			try {
				return readFileSync(join(fake, "log"), "utf8");
			} catch {
				return "";
			}
		},
	};
}

describe("remit config save writes the document the export produced", () => {
	const box = sandbox();
	const result = box.run([]);

	it("exits 0", () => {
		assert.equal(result.status, 0, result.stderr);
	});

	it("writes the export byte for byte", () => {
		assert.equal(box.written(), DOCUMENT);
	});

	it("runs the export through the alternate entrypoint", () => {
		assert.match(
			box.log(),
			/^compose run --rm --no-deps -T migrate node config-save\.mjs$/m,
		);
	});

	it("writes the document at 0600, not the caller's umask", () => {
		// The document carries the address book, filter text, mail excerpts and
		// signatures, so the operator's umask must not decide who can read it.
		// The umask of this process is the default 022, under which an
		// unguarded write lands at 0644.
		assert.equal(statSync(box.target).mode & 0o777, 0o600);
	});

	it("leaves no half-written file beside the target", () => {
		assert.deepEqual(box.leftovers(), []);
	});
});

describe("a log line inside the document is refused", () => {
	// The case the guard exists for. `compose run` merges the container's
	// streams, so a line the composition logs lands between two members of an
	// object that opens and closes exactly as it should — which is why the
	// document has to be parsed rather than checked at its two ends.
	const lines = DOCUMENT.split("\n");
	const corrupt = [...lines.slice(0, 3), LOG_LINE, ...lines.slice(3)].join(
		"\n",
	);
	const box = sandbox({ output: corrupt });
	const result = box.run([]);

	it("exits non-zero", () => {
		assert.notEqual(result.status, 0);
	});

	it("writes nothing at the target path", () => {
		assert.equal(box.written(), null);
	});

	it("says the export is not a JSON document", () => {
		assert.match(
			result.stderr,
			/is not a JSON document, so nothing was written/,
		);
	});

	it("removes the file it was writing", () => {
		assert.deepEqual(box.leftovers(), []);
	});
});

describe("a log line in front of the document is refused", () => {
	const box = sandbox({ output: `${LOG_LINE}\n${DOCUMENT}` });
	const result = box.run([]);

	it("exits non-zero and writes nothing", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.written(), null);
	});
});

describe("a document that stopped arriving is refused", () => {
	const box = sandbox({ output: DOCUMENT.slice(0, DOCUMENT.length - 40) });
	const result = box.run([]);

	it("exits non-zero and writes nothing", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.written(), null);
	});
});

describe("an export that failed is refused before it is checked", () => {
	const box = sandbox({ output: "", exportExit: 1 });
	const result = box.run([]);

	it("exits non-zero and writes nothing", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.written(), null);
	});

	it("says the export did not finish", () => {
		assert.match(result.stderr, /the export did not finish/);
	});
});

describe("a parse that could not run is not reported as damage", () => {
	// docker refusing the check has found nothing about the document. Telling
	// the operator their export is corrupt would send them looking for a fault
	// in the app that never happened.
	const box = sandbox({ parse: "refused" });
	const result = box.run([]);

	it("exits non-zero and writes nothing", () => {
		assert.notEqual(result.status, 0);
		assert.equal(box.written(), null);
	});

	it("names the check, not the document", () => {
		assert.match(result.stderr, /could not be checked for damage/);
		assert.doesNotMatch(result.stderr, /is not a JSON document/);
	});
});
