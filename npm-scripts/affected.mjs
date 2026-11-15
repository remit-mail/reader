#!/usr/bin/env node
// Prints `frontend=<bool>` and `backend=<bool>` for a commit range, in the
// shape `$GITHUB_OUTPUT` takes. Without a range (a push to main) both are true.
//
// Renames off and paths unquoted for the reasons npm-scripts/lib/docs-only.sh
// gives: a moved file must show up as the delete and the add it is.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { affected, readWorkspaces } from "./lib/affected.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [base, head] = process.argv.slice(2);

const changed = base
	? execFileSync(
			"git",
			[
				"-c",
				"core.quotePath=false",
				"diff",
				"--no-renames",
				"--name-only",
				`${base}...${head}`,
			],
			{ cwd: root, encoding: "utf8" },
		)
			.split("\n")
			.filter(Boolean)
	: [];

const result = affected(await readWorkspaces(root), changed);

console.error(`shared paths: ${result.shared.join(", ") || "none"}`);
console.error(`workspaces reached: ${result.reached.join(", ") || "none"}`);
console.log(`frontend=${result.frontend}`);
console.log(`backend=${result.backend}`);
