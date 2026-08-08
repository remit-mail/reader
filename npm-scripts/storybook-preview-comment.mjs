#!/usr/bin/env node
// Renders and posts the one sticky comment a pull request's Storybook preview
// lives behind, and decides whether ticking its checkbox may deploy. Shared
// state machine for all three preview workflows so a build, a refusal and a
// cleanup can never disagree about what the comment should say.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";

export const MARKER = "<!-- storybook-preview -->";
export const CHECKBOX_LABEL = "Deploy Storybook preview";
export const UNCHECKED_LINE = `- [ ] ${CHECKBOX_LABEL}`;
export const CHECKED_LINE = `- [x] ${CHECKBOX_LABEL}`;

const WRITE_PERMISSIONS = ["write", "maintain", "admin"];

const USAGE = `usage: storybook-preview-comment.mjs <command> [options]

Commands:
  render   Print the sticky comment body for a state.
  update   Create or rewrite the sticky preview comment on a pull request.
  resolve  Resolve a pull request head and decide whether a preview may deploy.
  state    Report whether a pull request is still open.

Options:
  --pr <number>       Pull request number (update, resolve, state).
  --state <state>     idle | building | deployed | failed | refused | removed.
  --actor <login>     Login that asked for the deploy (resolve).
  --sha <sha>         Commit the preview was built from.
  --url <url>         Published preview URL.
  --run-url <url>     Workflow run to link from the comment.
  --reason <text>     Why a deploy failed or was refused.
  --at <text>         Deploy timestamp (defaults to now, UTC).
  --no-create         Rewrite the comment only if it already exists.
  --repo <owner/name> Repository (defaults to $GITHUB_REPOSITORY).

resolve writes eligible, reason and head-sha to $GITHUB_OUTPUT, and state
writes open, or both write to stdout when that variable is unset.`;

function shortSha(sha) {
	return sha.slice(0, 7);
}

function statusLines(view) {
	if (view.state === "building") {
		return [
			`Building \`${shortSha(view.sha)}\` — [follow the run](${view.runUrl}).`,
			"",
			"Stuck here longer than the run above takes? Tick the box again to retry.",
		];
	}
	if (view.state === "deployed") {
		return [
			`**[Open the preview](${view.url})** — built from \`${shortSha(view.sha)}\` at ${view.at}.`,
			"",
			"Tick the box again to publish a newer commit. The preview is deleted when this pull request closes.",
		];
	}
	if (view.state === "failed") {
		return [
			`The preview did not deploy: ${view.reason} — [see the run](${view.runUrl}).`,
			"",
			"Tick the box to try again.",
		];
	}
	if (view.state === "refused") {
		return [`No preview was deployed: ${view.reason}`];
	}
	if (view.state === "removed") {
		return [
			"This pull request is closed. Any Storybook preview it had has been deleted.",
		];
	}
	return [
		"Tick the box to publish a Storybook preview of this branch. It needs write access on this repository, and branches pushed to a fork are not previewed.",
	];
}

export function renderBody(view) {
	const heading = [MARKER, "", "### Storybook preview", ""];
	if (view.state === "removed") {
		return [...heading, ...statusLines(view), ""].join("\n");
	}
	return [...heading, UNCHECKED_LINE, "", ...statusLines(view), ""].join("\n");
}

export function decideEligibility(input) {
	if (input.prState !== "open") {
		return { eligible: false, reason: "this pull request is not open." };
	}
	if (input.headRepo !== input.baseRepo) {
		return {
			eligible: false,
			reason: `the branch lives in a fork (\`${input.headRepo}\`), and a preview builds branch code with the deploy token.`,
		};
	}
	if (!WRITE_PERMISSIONS.includes(input.permission)) {
		return {
			eligible: false,
			reason: "deploying a preview needs write access on this repository.",
		};
	}
	return { eligible: true, reason: "" };
}

export function formatTimestamp(date) {
	return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function gh(args, input = undefined) {
	return execFileSync("gh", args, {
		encoding: "utf8",
		input,
		maxBuffer: 32 * 1024 * 1024,
	}).trim();
}

function findStickyComment(repo, pr) {
	const filter = `.[] | select(.user.type == "Bot") | select(.body | contains("${MARKER}")) | .id`;
	const found = gh([
		"api",
		"--paginate",
		`repos/${repo}/issues/${pr}/comments`,
		"--jq",
		filter,
	]);
	return found.split("\n").filter(Boolean)[0] ?? "";
}

function upsertComment(repo, pr, body, create) {
	const id = findStickyComment(repo, pr);
	const payload = JSON.stringify({ body });
	if (id) {
		gh(
			[
				"api",
				"--silent",
				"--method",
				"PATCH",
				`repos/${repo}/issues/comments/${id}`,
				"--input",
				"-",
			],
			payload,
		);
		return;
	}
	if (!create) {
		return;
	}
	gh(
		[
			"api",
			"--silent",
			"--method",
			"POST",
			`repos/${repo}/issues/${pr}/comments`,
			"--input",
			"-",
		],
		payload,
	);
}

function collaboratorPermission(repo, actor) {
	// A login with no collaborator entry answers 404 rather than "none".
	try {
		return gh([
			"api",
			`repos/${repo}/collaborators/${actor}/permission`,
			"--jq",
			".permission",
		]);
	} catch {
		return "none";
	}
}

function writeOutputs(entries) {
	const text = `${Object.entries(entries)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")}\n`;
	const file = process.env.GITHUB_OUTPUT;
	if (!file) {
		process.stdout.write(text);
		return;
	}
	appendFileSync(file, text);
}

function resolve(repo, pr, actor) {
	const fields = gh([
		"api",
		`repos/${repo}/pulls/${pr}`,
		"--jq",
		"[.state, .head.sha, .head.repo.full_name, .base.repo.full_name] | @tsv",
	]).split("\t");
	const [prState, headSha, headRepo, baseRepo] = fields;
	const decision = decideEligibility({
		prState,
		headRepo,
		baseRepo,
		permission: collaboratorPermission(repo, actor),
	});
	writeOutputs({
		eligible: String(decision.eligible),
		reason: decision.reason,
		"head-sha": headSha,
	});
}

function reportOpen(repo, pr) {
	const state = gh(["api", `repos/${repo}/pulls/${pr}`, "--jq", ".state"]);
	writeOutputs({ open: String(state === "open") });
}

function fail(message) {
	process.stderr.write(`${message}\n\n${USAGE}\n`);
	process.exit(2);
}

function main(argv) {
	const command = argv[0];
	if (!command || command === "--help" || command === "-h") {
		process.stdout.write(`${USAGE}\n`);
		return;
	}

	const { values } = parseArgs({
		args: argv.slice(1),
		options: {
			pr: { type: "string", default: "" },
			state: { type: "string", default: "idle" },
			actor: { type: "string", default: "" },
			sha: { type: "string", default: "" },
			url: { type: "string", default: "" },
			"run-url": { type: "string", default: "" },
			reason: { type: "string", default: "" },
			at: { type: "string", default: "" },
			"no-create": { type: "boolean", default: false },
			repo: { type: "string", default: process.env.GITHUB_REPOSITORY ?? "" },
		},
	});

	const view = {
		state: values.state ?? "idle",
		sha: values.sha ?? "",
		url: values.url ?? "",
		runUrl: values["run-url"] ?? "",
		reason: values.reason ?? "",
		at: values.at || formatTimestamp(new Date()),
	};

	if (command === "render") {
		process.stdout.write(renderBody(view));
		return;
	}

	if (!values.repo) {
		fail("a repository is required: pass --repo or set GITHUB_REPOSITORY");
	}
	if (!values.pr) {
		fail("a pull request number is required: pass --pr");
	}

	if (command === "update") {
		upsertComment(
			values.repo,
			values.pr,
			renderBody(view),
			!values["no-create"],
		);
		return;
	}

	if (command === "state") {
		reportOpen(values.repo, values.pr);
		return;
	}

	if (command === "resolve") {
		if (!values.actor) {
			fail("an actor login is required: pass --actor");
		}
		resolve(values.repo, values.pr, values.actor);
		return;
	}

	fail(`unknown command: ${command}`);
}

if (import.meta.filename === process.argv[1]) {
	main(process.argv.slice(2));
}
