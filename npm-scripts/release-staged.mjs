#!/usr/bin/env node
// Releases the versions CI staged with `npm stage publish`. Lists every staged
// version of a publishable @remit/* package, then approves each with one
// one-time password, asking for a fresh one only when the registry stops
// accepting the current one. An empty answer hands each approval to npm's own
// 2FA prompt instead, for accounts that authenticate in the browser.
//
// Usage: release-staged.mjs [--dry-run]
//   --dry-run  list the staged versions, approve nothing.
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./lib/publishable-packages.mjs";
import { isOtpRejected } from "./lib/registry-fetch.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

const order = publishablePackages(repoRoot).map(({ name }) => name);

const versionParts = (version) =>
	version
		.split("-")[0]
		.split(".")
		.map((part) => Number(part));

const compareVersions = (a, b) => {
	const left = versionParts(a);
	const right = versionParts(b);
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return 0;
};

const stagedItems = () => {
	const items = JSON.parse(
		execFileSync("npm", ["stage", "list", "--json", "--loglevel=error"], {
			cwd: repoRoot,
			encoding: "utf8",
		}),
	);
	return items
		.filter(({ packageName }) => order.includes(packageName))
		.sort(
			(a, b) =>
				order.indexOf(a.packageName) - order.indexOf(b.packageName) ||
				compareVersions(a.version, b.version),
		);
};

let pipedLines;

const readPipedLine = async () => {
	pipedLines ??= createInterface({ input: process.stdin })[
		Symbol.asyncIterator
	]();
	const { value, done } = await pipedLines.next();
	return done ? "" : value.trim();
};

const readHiddenLine = () =>
	new Promise((resolve) => {
		const { stdin } = process;
		let value = "";
		const finish = () => {
			stdin.setRawMode(false);
			stdin.pause();
			stdin.off("data", onData);
			process.stdout.write("\n");
			resolve(value.trim());
		};
		const onData = (chunk) => {
			for (const char of chunk) {
				if (char === "\r" || char === "\n") return finish();
				if (char === "\u0003") {
					stdin.setRawMode(false);
					process.exit(130);
				}
				if (char === "\u007f") value = value.slice(0, -1);
				else value += char;
			}
		};
		stdin.setEncoding("utf8");
		stdin.setRawMode(true);
		stdin.resume();
		stdin.on("data", onData);
	});

const readOtp = (prompt) => {
	process.stdout.write(prompt);
	return process.stdin.isTTY ? readHiddenLine() : readPipedLine();
};

// The OTP travels in npm's environment, not its argv, so it never shows in ps.
const approve = (stageId, otp) => {
	if (!otp) {
		const { status } = spawnSync("npm", ["stage", "approve", stageId], {
			cwd: repoRoot,
			stdio: "inherit",
		});
		return status === 0 ? "approved" : "failed";
	}
	const { status, stderr } = spawnSync("npm", ["stage", "approve", stageId], {
		cwd: repoRoot,
		env: { ...process.env, npm_config_otp: otp },
		stdio: ["ignore", "inherit", "pipe"],
		encoding: "utf8",
	});
	if (status === 0) return "approved";
	if (stderr) process.stderr.write(stderr);
	return isOtpRejected({ stderr }) ? "otp-rejected" : "failed";
};

const items = stagedItems();
if (items.length === 0) {
	console.log("No staged @remit/* versions.");
	process.exit(0);
}

console.log(`Staged versions (${items.length}):`);
for (const { packageName, version, tag, createdAt, id } of items)
	console.log(`  ${packageName}@${version}  ${tag}  ${createdAt}  ${id}`);

if (dryRun) process.exit(0);

let otp = await readOtp(
	"\nOne-time password (empty to let npm prompt per package): ",
);
const failures = [];

for (const item of items) {
	const label = `${item.packageName}@${item.version}`;
	let outcome = approve(item.id, otp);
	if (outcome === "otp-rejected") {
		otp = await readOtp(`\nThe registry refused the OTP; a new one: `);
		outcome = approve(item.id, otp);
	}
	if (outcome === "approved") console.log(`released ${label}`);
	else failures.push(label);
}

if (failures.length > 0) {
	console.error("\nNot released:");
	for (const label of failures) console.error(`  ${label}`);
	process.exit(1);
}
