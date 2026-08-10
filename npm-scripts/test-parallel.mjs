#!/usr/bin/env node
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { undeclaredExclusions } from "./lib/ci-coverage.mjs";
import { readWorkflowSources } from "./lib/workflows.mjs";
import {
	discoverWorkspaces,
	WORKSPACE_SCRIPT,
} from "./lib/workspace-suites.mjs";

// The tree to run, this repo unless a path is given. The suite points it at a
// fixture tree so the exclusion check below is exercised as the runner calls
// it, not only as a pure function.
const root = resolve(
	process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
);

const OUTPUT_LIMIT = 64 * 1024 * 1024;

// Far above the slowest suite on the slowest runner, because crossing it means
// stuck rather than slow. A suite whose tests have all passed but whose process
// never exits is otherwise invisible: the run waits on it forever, and what CI
// reports is a SIGTERM from the runner host with no suite named.
const SUITE_TIMEOUT_MS = Math.max(
	1,
	Number.parseInt(process.env.TEST_SUITE_TIMEOUT_MS ?? "", 10) || 900_000,
);

// Suites still running, by name, so a run that is cut short can still say what
// it was waiting on.
const live = new Map();

// The child is npm and the suite is npm's child, so signalling the child alone
// leaves the suite running and holding the pipes open. Each suite gets its own
// process group and the group is what gets killed.
function killGroup(pid) {
	if (!pid) return;
	// ESRCH: the group went on its own between the decision and the signal.
	try {
		process.kill(-pid, "SIGKILL");
	} catch {}
}

function runUnit({ name, command: [file, args] }) {
	return new Promise((resolve) => {
		const started = Date.now();
		const child = spawn(file, args, {
			cwd: root,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		live.set(name, { pid: child.pid, started });

		const chunks = [];
		let size = 0;
		let truncated = false;
		const collect = (chunk) => {
			if (size >= OUTPUT_LIMIT) {
				truncated = true;
				return;
			}
			size += chunk.length;
			chunks.push(chunk);
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);

		let hung = false;
		const clock = setTimeout(() => {
			hung = true;
			killGroup(child.pid);
		}, SUITE_TIMEOUT_MS);

		const settle = (ok) => {
			clearTimeout(clock);
			live.delete(name);
			const note = truncated ? "\n[output truncated]" : "";
			resolve({
				name,
				ok: ok && !hung,
				hung,
				ms: Date.now() - started,
				output: `${Buffer.concat(chunks).toString()}${note}`,
			});
		};
		child.on("error", (error) => {
			collect(Buffer.from(`${error.message}\n`));
			settle(false);
		});
		child.on("close", (code, signal) => {
			settle(code === 0 && signal === null);
		});
	});
}

// Detaching each suite also detaches it from the terminal's own Ctrl-C, so an
// abandoned run would leave the whole fanout behind. What the signal interrupts
// is worth saying: the suites still listed here are the ones nothing has heard
// back from.
function abandon(signal, status) {
	const waiting = [...live.entries()].map(
		([name, { started }]) =>
			`${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
	);
	if (waiting.length > 0) {
		console.log(`\n${signal} while still waiting on: ${waiting.join(", ")}`);
	}
	for (const { pid } of live.values()) killGroup(pid);
	process.exit(status);
}

process.on("SIGINT", () => abandon("SIGINT", 130));
process.on("SIGTERM", () => abandon("SIGTERM", 143));

async function main() {
	const exclude = (process.env.TEST_EXCLUDE ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	const { sources } = await readWorkflowSources(root);
	const undeclared = undeclaredExclusions(exclude, sources);
	if (undeclared.length > 0) {
		throw new Error(
			`TEST_EXCLUDE drops ${undeclared.join(", ")}, which no workflow file declares. ` +
				"check:ci-coverage reads the exclusions out of the workflow text and can " +
				"see no other source, so these suites would run nowhere and nothing " +
				"would say so. Declare the exclusion in the workflow that sets it.",
		);
	}
	const { suites, skipped } = await discoverWorkspaces(root, { exclude });
	if (skipped.length > 0) {
		console.log(`no tests to run for: ${skipped.join(", ")}`);
	}
	const units = suites
		.map((suite) => ({
			...suite,
			command: ["npm", ["run", WORKSPACE_SCRIPT, "-w", suite.workspace]],
		}))
		.sort((a, b) => b.weight - a.weight);
	const requested = Number.parseInt(process.env.TEST_CONCURRENCY ?? "", 10);
	const limit = Number.isNaN(requested)
		? Math.max(1, Math.min(availableParallelism(), 4))
		: Math.max(1, requested);
	const queue = [...units];
	const results = [];

	// Said on the way in as well as on the way out, so a run that dies mid-flight
	// still names the suite it was inside. Two consecutive CI jobs were killed on
	// a suite that never exited, and the only trace was one PASS line missing
	// from twenty-two.
	const worker = async () => {
		for (;;) {
			const next = queue.shift();
			if (!next) return;
			console.log(`RUN ${next.name}`);
			const result = await runUnit(next);
			results.push(result);
			const verdict = result.hung ? "HANG" : result.ok ? "PASS" : "FAIL";
			console.log(
				`${verdict} ${result.name} (${(result.ms / 1000).toFixed(1)}s)`,
			);
		}
	};

	const started = Date.now();
	await Promise.all(Array.from({ length: limit }, worker));

	const failed = results.filter((result) => !result.ok);
	for (const result of failed) {
		console.log(`\n::group::${result.name} output`);
		console.log(result.output);
		console.log("::endgroup::");
	}

	console.log(
		`\n${results.length - failed.length}/${results.length} suites passed in ${((Date.now() - started) / 1000).toFixed(1)}s (concurrency ${limit})`,
	);

	if (failed.length > 0) {
		console.log(`failing suites: ${failed.map((r) => r.name).join(", ")}`);
		const hung = failed.filter((result) => result.hung);
		if (hung.length > 0) {
			console.log(
				`killed after ${SUITE_TIMEOUT_MS}ms without exiting: ${hung
					.map((result) => result.name)
					.join(
						", ",
					)}. The tests may all have passed — look for a handle the ` +
					"suite leaves open rather than a failing assertion.",
			);
		}
		process.exitCode = 1;
	}
}

await main();
