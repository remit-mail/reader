// The heap ceiling every Node service in the reference deployment runs under.
//
// V8 sizes its old space against the host rather than against the container, so
// without a cap one heavy job on a 4 GB box grows until the kernel picks a
// victim — and the victim is rarely the process that caused it. The cap is a
// property of the committed deployment, so it is asserted against the compose
// file rather than a running stack.
//
// Which services need it is derived from the Dockerfile — the CMD that actually
// starts the container — not from a list kept here. A new Node service added to
// the stack without a ceiling fails this suite.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const COMPOSE = readFileSync(
	join(ROOT, "deploy", "vps", "docker-compose.sqlite.yml"),
	"utf8",
);
const DOCKERFILE = readFileSync(join(ROOT, "Dockerfile"), "utf8");
const TEMPLATE = readFileSync(
	join(ROOT, "deploy", "vps", "remit.env.template"),
	"utf8",
);

const HEAP = '"--max-old-space-size=${REMIT_NODE_HEAP_MB:-512}"';

// Build targets whose container starts node. Every target that runs the runtime
// declares its own CMD, so an inherited one is never in play here.
function nodeImageTargets(source) {
	const targets = new Set();
	let target = null;
	for (const line of source.split("\n")) {
		const from = line.match(/^FROM\s+\S+\s+AS\s+(\S+)\s*$/);
		if (from) {
			target = from[1];
			continue;
		}
		if (!target) continue;
		if (/^(CMD|ENTRYPOINT)\s+\["node"/.test(line)) targets.add(target);
	}
	return targets;
}

// Services at two-space indent, their keys at four, entries at six — the same
// compose-shaped scan the sibling suites use, so this needs no docker and no
// env to run.
function serviceBlocks(source) {
	const result = {};
	let inServices = false;
	let service = null;
	for (const line of source.split("\n")) {
		if (/^services:\s*$/.test(line)) {
			inServices = true;
			continue;
		}
		if (!inServices) continue;
		if (/^\S/.test(line)) {
			inServices = false;
			service = null;
			continue;
		}
		const svc = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
		if (svc) {
			service = svc[1];
			result[service] = [];
			continue;
		}
		if (service) result[service].push(line);
	}
	return result;
}

// The `&app-environment` map, which lives above `services:` and reaches a
// service through a merge key.
function anchoredEnvironment(source) {
	const header = source.split(/^services:\s*$/m)[0];
	const after =
		header.split(/^ {2}environment: &app-environment\s*$/m)[1] ?? "";
	const entries = {};
	for (const line of after.split("\n")) {
		const pair = line.match(/^ {4}([A-Za-z0-9_]+):\s*(.*)$/);
		if (pair) {
			entries[pair[1]] = pair[2];
			continue;
		}
		if (/^\s*#/.test(line) || line.trim() === "") continue;
		break;
	}
	return entries;
}

function environment(lines) {
	const entries = {};
	let inside = false;
	for (const line of lines) {
		if (/^ {4}environment:\s*$/.test(line)) {
			inside = true;
			continue;
		}
		if (!inside) continue;
		const pair = line.match(/^ {6}([A-Za-z0-9_]+):\s*(.*)$/);
		if (pair) {
			entries[pair[1]] = pair[2];
			continue;
		}
		if (/^ {2,4}\S/.test(line)) inside = false;
	}
	return entries;
}

// A service-level key, whose value compose allows on the same line or wrapped
// onto the next one.
function directive(lines, key) {
	const opener = new RegExp(`^ {4}${key}:\\s*(.*)$`);
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(opener);
		if (!match) continue;
		return match[1].trim() || (lines[index + 1] ?? "").trim();
	}
	return undefined;
}

const nodeTargets = nodeImageTargets(DOCKERFILE);
const blocks = serviceBlocks(COMPOSE);
const anchored = anchoredEnvironment(COMPOSE);

function value(lines, key) {
	const own = environment(lines);
	if (Object.hasOwn(own, key)) return own[key];
	if (/<<: \*app-env(ironment)?$/m.test(lines.join("\n"))) return anchored[key];
	return undefined;
}

// A service runs node when a compose override says so, or — absent an override —
// when the image it runs starts node.
function runsNode(lines) {
	const start = directive(lines, "entrypoint") ?? directive(lines, "command");
	if (start) return start.startsWith('["node"');
	const image = directive(lines, "image") ?? "";
	const target = image.match(/^ghcr\.io\/remit-mail\/reader\/([a-z0-9-]+):/);
	return Boolean(target) && nodeTargets.has(target[1]);
}

const nodeServices = Object.entries(blocks)
	.filter(([, lines]) => runsNode(lines))
	.map(([service]) => service)
	.sort();

describe("the deployment's Node services run under a heap ceiling", () => {
	it("finds the services that start node", () => {
		assert.deepEqual(nodeServices, [
			"account-worker",
			"backend",
			"doctor",
			"imap-worker",
			"migrate",
			"queue",
			"scheduler",
			"search-index-worker",
			"smtp-worker",
			"web",
		]);
	});

	it("caps every one of them", () => {
		for (const service of nodeServices) {
			assert.equal(
				value(blocks[service], "NODE_OPTIONS"),
				HEAP,
				`${service} runs node with no old-space ceiling, so V8 grows against the host`,
			);
		}
	});

	it("caps search-index-worker, the heaviest of them, at the shared default", () => {
		assert.equal(value(blocks["search-index-worker"], "NODE_OPTIONS"), HEAP);
	});

	it("reads the ceiling from one variable with one default", () => {
		const declared = [...COMPOSE.matchAll(/NODE_OPTIONS: (.*)$/gm)].map(
			(match) => match[1],
		);
		assert.ok(declared.length > 0);
		assert.deepEqual([...new Set(declared)], [HEAP]);
	});

	it("imposes no hard container limit, which would kill a slow job instead of slowing it", () => {
		assert.ok(!/^ {4}mem_limit:/m.test(COMPOSE));
		assert.ok(!/^ {6}resources:/m.test(COMPOSE));
	});

	it("documents the knob where the operator edits configuration", () => {
		assert.match(TEMPLATE, /^# REMIT_NODE_HEAP_MB=512$/m);
	});
});
