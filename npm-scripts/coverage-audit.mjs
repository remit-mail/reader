import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");

const covFlags =
	"--experimental-test-coverage --test-coverage-include='src/**' --test-coverage-exclude='src/**/*.test.ts' --test-coverage-exclude='src/**/*.test.tsx'";

function injectCoverage(cmd) {
	return cmd
		.split(" && ")
		.map((part) => {
			if (!part.includes("--test ") && !part.includes("--test'")) return part;
			return part.replace(/(\s)--test\b/, ` ${covFlags} --test`);
		})
		.join(" && ");
}

function parseAllFiles(output) {
	const lines = output.split("\n");
	const row = lines.find((l) => /all files/.test(l));
	if (!row) return null;
	const cells = row
		.replace(/^ℹ\s*/, "")
		.split("|")
		.map((c) => c.trim());
	return {
		lines: Number.parseFloat(cells[1]),
		branch: Number.parseFloat(cells[2]),
		funcs: Number.parseFloat(cells[3]),
	};
}

const only = process.argv.slice(2);
const results = [];
for (const name of readdirSync(packagesDir).sort()) {
	if (only.length && !only.includes(name)) continue;
	const dir = join(packagesDir, name);
	if (!statSync(dir).isDirectory()) continue;
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	} catch {
		continue;
	}
	const testRun = manifest.scripts?.["test:run"];
	if (!testRun) {
		results.push({ name, status: "no-tests" });
		continue;
	}
	const cmd = injectCoverage(testRun);
	const result = spawnSync(cmd, {
		cwd: dir,
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
		shell: "/bin/bash",
	});
	const ok = result.status === 0;
	const output = ok
		? (result.stdout ?? "")
		: `${result.stdout ?? ""}${result.stderr ?? ""}`;
	const cov = parseAllFiles(output);
	const r = { name, status: ok ? "ok" : "fail", cov, testRun };
	results.push(r);
	if (!cov) {
		console.log(`${r.name}\t${r.status}\tNO-COVERAGE-PARSED`);
	} else {
		console.log(
			`${r.name}\t${r.status}\tlines=${cov.lines}\tbranch=${cov.branch}\tfuncs=${cov.funcs}`,
		);
	}
}
