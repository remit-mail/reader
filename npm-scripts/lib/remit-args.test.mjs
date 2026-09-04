// Every `remit` subcommand refuses an argument it does not understand
// (reader#1047).
//
// `status` and `down` used to take any argument, drop it, run their normal path
// and exit 0. That is how `remit config save reader-config.json` on a wrapper
// predating `config save` reported a successful export that never happened: the
// exit code is the only thing an operator or a cron line has to go on, so a
// swallowed argument is a lie about what ran.
//
// The verbs are read out of the wrapper's own dispatcher rather than listed
// here, so one added later has no test until it is classified below. Sub-verbs
// dispatched inside a handler — `config save` — are not visible that way and
// are covered by hand.
//
// Every case is driven end to end, because the claim is about the exit code and
// the message an operator sees rather than about which line of shell checks
// what.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const REMIT = join(ROOT, "deploy", "vps", "remit");
const COMPOSE = join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml");

const TMP_ROOT = join(ROOT, ".tmp");
mkdirSync(TMP_ROOT, { recursive: true });
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

// A port nothing listens on, so status's reachability probe fails at once
// instead of spending its timeout on a name that does not resolve.
const ORIGIN = "https://127.0.0.1:1";

// The dispatcher's own arm patterns, one tab deep between `case "$_cmd" in` and
// its `esac`. `*)` is the unknown-command arm, not a verb.
function dispatchedSubcommands() {
	const source = readFileSync(REMIT, "utf8");
	const start = source.indexOf('\tcase "$_cmd" in\n');
	assert.notEqual(start, -1, "the wrapper no longer dispatches on $_cmd");
	const end = source.indexOf("\n\tesac\n", start);
	assert.notEqual(end, -1, "the dispatcher's case has no esac");
	const names = new Set();
	for (const line of source.slice(start, end).split("\n")) {
		const arm = /^\t(?!\t)([^\t)]+)\)/.exec(line);
		if (!arm) continue;
		for (const pattern of arm[1].split("|")) {
			const name = pattern.trim();
			if (name && name !== "*") names.add(name);
		}
	}
	return names;
}

// A docker that records what it was asked for, does nothing and succeeds.
// Argument handling is decided before the stack is touched, so what compose
// would have answered cannot change the verdict — and a stand-in that succeeds
// is the hostile case: a verb that swallows its argument runs to the end of its
// normal path and exits 0.
function run(args) {
	const dir = mkdtempSync(join(TMP_ROOT, "remit-args-"));
	sandboxes.push(dir);
	const deployment = join(dir, "deployment");
	const bin = join(dir, "bin");
	for (const d of [deployment, bin]) mkdirSync(d, { recursive: true });

	copyFileSync(COMPOSE, join(deployment, "docker-compose.sqlite.yml"));
	writeFileSync(
		join(deployment, ".env"),
		[
			"REMIT_TAG=v1.0.0",
			`PUBLIC_ORIGIN=${ORIGIN}`,
			"TLS_MODE=internal",
			"",
		].join("\n"),
	);
	const argv = join(dir, "argv");
	writeFileSync(argv, "");
	writeFileSync(
		join(bin, "docker"),
		'#!/bin/sh\nprintf "%s\\n" "$*" >>"$ARGV_LOG"\nexit 0\n',
		{ mode: 0o755 },
	);

	const result = spawnSync("sh", [REMIT, ...args], {
		encoding: "utf8",
		// `config save` writes beside the file it is given, so a relative path
		// has to land somewhere the sandbox owns.
		cwd: dir,
		env: {
			PATH: `${bin}:${process.env.PATH}`,
			HOME: dir,
			REMIT_DIR: deployment,
			ARGV_LOG: argv,
		},
	});
	return { ...result, argv: readFileSync(argv, "utf8") };
}

// Per verb: every message its parser can turn a form away with, the forms it
// has to take, and the ones it has to refuse.
//
// `refusal` is what makes `takes` mean anything — a form is accepted when the
// parser did not turn it away, and only an exhaustive list of that verb's
// parse-time messages decides that. `update --tag` is the case the distinction
// is for: asking for the value the option needs is the parser recognising it.
//
// `proof` is what the accepted form went on to do — the docker invocation it
// reached, or the line it printed. Without it "no refusal" would also be true
// of a command that did nothing at all.
const CASES = {
	restart: {
		refusal: /^remit: restart: unknown option/m,
		takes: [
			{ args: [], proof: / up -d$/m },
			{ args: ["--hard"], proof: / stop$/m },
		],
		refuses: [
			{ args: ["zzz"], message: /^remit: restart: unknown option 'zzz'/m },
			{
				args: ["--hard", "zzz"],
				message: /^remit: restart: unknown option 'zzz'/m,
			},
		],
	},
	logs: {
		// The arguments are service names and the compose file is the authority
		// on those: `docker compose logs` refuses one it does not define, and a
		// second list in here would be a copy that rots. What this wrapper owes
		// is that the name arrives there unchanged.
		refusal: /^remit: logs:/m,
		takes: [
			{ args: [], proof: /^compose .* logs -f --tail=100$/m },
			{ args: ["caddy"], proof: /^compose .* logs -f --tail=100 caddy$/m },
			{
				args: ["no-such-service"],
				proof: /^compose .* logs -f --tail=100 no-such-service$/m,
			},
		],
		refuses: [],
	},
	status: {
		refusal: /^remit: status: unknown argument/m,
		takes: [{ args: [], proof: /^Directory: /m }],
		refuses: [
			{ args: ["zzz"], message: /^remit: status: unknown argument 'zzz'/m },
			{ args: ["--json"], message: /^remit: status: unknown argument/m },
		],
	},
	update: {
		// Not the bare form: it would run an update.
		refusal: /^remit: update: unknown option/m,
		takes: [
			{ args: ["--check"], proof: /^Updates: /m },
			{ args: ["--recover"], proof: /No interrupted update to recover\./ },
			{ args: ["--preflight"], proof: /--entrypoint sh /m },
			{ args: ["--tag"], proof: /^remit: update: --tag needs a value$/m },
		],
		refuses: [
			{ args: ["zzz"], message: /^remit: update: unknown option 'zzz'/m },
			{ args: ["--force"], message: /^remit: update: unknown option/m },
		],
	},
	down: {
		refusal: /^remit: down: unknown argument/m,
		takes: [{ args: [], proof: /^remit is stopped: /m }],
		refuses: [
			{ args: ["zzz"], message: /^remit: down: unknown argument 'zzz'/m },
			{ args: ["--all"], message: /^remit: down: unknown argument/m },
		],
	},
	purge: {
		refusal: /^remit: purge: unknown option/m,
		takes: [
			{ args: [], proof: / config --volumes$/m },
			{ args: ["--yes"], proof: / down -v --remove-orphans$/m },
		],
		refuses: [
			{ args: ["zzz"], message: /^remit: purge: unknown option 'zzz'/m },
			{ args: ["--force"], message: /^remit: purge: unknown option/m },
		],
	},
	doctor: {
		refusal: /^remit: doctor: unknown option/m,
		takes: [
			{ args: [], proof: / exec -T doctor node check\.mjs$/m },
			{
				args: ["--json"],
				proof: / exec -T doctor node check\.mjs --json$/m,
			},
		],
		refuses: [
			{ args: ["zzz"], message: /^remit: doctor: unknown option 'zzz'/m },
			{ args: ["--verbose"], message: /^remit: doctor: unknown option/m },
		],
	},
	semantic: {
		refusal: /^remit: semantic: (takes one argument|'.*' is not a setting)/m,
		takes: [
			{ args: [], proof: /Search section of README\.md/ },
			{ args: ["on"], proof: / up -d$/m },
			{ args: ["off"], proof: / rm --force --stop search-index-worker$/m },
		],
		refuses: [
			{ args: ["zzz"], message: /^remit: semantic: 'zzz' is not a setting/m },
			{ args: [""], message: /^remit: semantic: '' is not a setting/m },
			{ args: ["on", "off"], message: /^remit: semantic: takes one argument/m },
		],
	},
	config: {
		refusal: /^remit: config( save)?: (unknown|takes|needs)/m,
		takes: [
			{ args: [], proof: /^TLS_MODE=internal$/m },
			{ args: ["save", "config.json"], proof: /^Wrote config\.json\.$/m },
			{
				args: ["save", "config.json", "--user", "who@example.com"],
				proof: /node config-save\.mjs --user who@example\.com$/m,
			},
		],
		refuses: [
			{ args: ["zzz"], message: /^remit: config: unknown argument 'zzz'/m },
			{
				args: ["save", "config.json", "--zzz"],
				message: /^remit: config save: unknown option '--zzz'/m,
			},
			{
				args: ["save", "one.json", "two.json"],
				message: /^remit: config save: takes one file/m,
			},
			{ args: ["save"], message: /^remit: config save: needs a file to write/m },
		],
	},
	"check-categories": {
		refusal: /^remit: check-categories: takes no arguments/m,
		takes: [{ args: [], proof: /migrate node migrate\.mjs --check$/m }],
		refuses: [
			{
				args: ["zzz"],
				message: /^remit: check-categories: takes no arguments/m,
			},
		],
	},
	cert: {
		refusal: /^remit: cert: unknown option/m,
		takes: [{ args: [], proof: /^compose .* cp caddy:/m }],
		refuses: [
			{ args: ["zzz"], message: /^remit: cert: unknown option 'zzz'/m },
			{ args: ["--out"], message: /^remit: cert: unknown option/m },
		],
	},
	"probe-host": {
		refusal: /^remit: probe-host: needs one origin/m,
		takes: [{ args: ["127.0.0.1"], proof: /loopback 127\.0\.0\.1/ }],
		refuses: [
			{ args: [], message: /^remit: probe-host: needs one origin/m },
			{
				args: ["127.0.0.1", "127.0.0.2"],
				message: /^remit: probe-host: needs one origin/m,
			},
		],
	},
	help: {
		refusal: /^remit: help: unknown argument/m,
		takes: [{ args: [], proof: /^Usage: remit <command>/m }],
		refuses: [
			{ args: ["zzz"], message: /^remit: help: unknown argument 'zzz'/m },
		],
	},
	"--help": {
		refusal: /^remit: --help: unknown argument/m,
		takes: [{ args: [], proof: /^Usage: remit <command>/m }],
		refuses: [
			{ args: ["zzz"], message: /^remit: --help: unknown argument 'zzz'/m },
		],
	},
	"-h": {
		refusal: /^remit: -h: unknown argument/m,
		takes: [{ args: [], proof: /^Usage: remit <command>/m }],
		refuses: [
			{ args: ["zzz"], message: /^remit: -h: unknown argument 'zzz'/m },
		],
	},
};

const form = (args) =>
	args.length ? args.map((a) => (a === "" ? "''" : a)).join(" ") : "no argument";

describe("the subcommands remit dispatches", () => {
	it("are all classified here, so a new one arrives with its rule", () => {
		assert.deepEqual(
			[...dispatchedSubcommands()].sort(),
			Object.keys(CASES).sort(),
		);
	});
});

for (const [command, spec] of Object.entries(CASES)) {
	describe(`remit ${command} argument handling`, () => {
		for (const { args, proof } of spec.takes) {
			it(`takes ${form(args)}`, () => {
				const result = run([command, ...args]);
				assert.ok(
					!spec.refusal.test(result.stderr),
					`the parser turned away a form it must take:\n${result.stderr}`,
				);
				assert.match(
					`${result.stdout}${result.stderr}${result.argv}`,
					proof,
					`the form was not refused and did nothing either:\n${result.stdout}${result.stderr}${result.argv}`,
				);
			});
		}

		for (const { args, message } of spec.refuses) {
			it(`refuses ${form(args)}, loudly`, () => {
				const result = run([command, ...args]);
				assert.notEqual(
					result.status,
					0,
					`exit 0 reports work that never ran:\n${result.stdout}`,
				);
				assert.match(result.stderr, message);
				assert.match(result.stderr, spec.refusal);
			});
		}
	});
}
