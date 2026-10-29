import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { apiBreaks, apiSurface } from "./api-diff.mjs";

// The validate job runs these suites without the workspace install; the
// publish dry run, which installs, runs this one again with the compiler.
const ts = await import("typescript")
	.then((module) => module.default)
	.catch((error) => {
		if (error.code === "ERR_MODULE_NOT_FOUND") return null;
		throw error;
	});

const root = mkdtempSync(join(tmpdir(), "api-diff-"));
after(() => rmSync(root, { recursive: true, force: true }));

let fixtureCount = 0;
const writePackage = (exports, files) => {
	fixtureCount += 1;
	const dir = join(root, String(fixtureCount));
	const all = {
		"package.json": JSON.stringify({
			name: "fixture",
			version: "0.0.0",
			exports,
		}),
		...files,
	};
	for (const [path, content] of Object.entries(all)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
	return dir;
};

const rootEntry = { ".": { types: "./index.d.ts", default: "./index.js" } };

const breaksBetween = (exports, before, afterFiles) =>
	apiBreaks(
		apiSurface(ts, writePackage(exports, before)),
		apiSurface(ts, writePackage(exports, afterFiles)),
	);

describe("apiBreaks", {
	skip: ts === null && "typescript is not installed",
}, () => {
	it("reports an export the new version removes", () => {
		assert.deepEqual(
			breaksBetween(
				rootEntry,
				{
					"index.d.ts":
						"export interface BodyPartStorage { put(key: string): Promise<void>; }\nexport declare const version: string;\n",
				},
				{ "index.d.ts": "export declare const version: string;\n" },
			),
			["removed . BodyPartStorage"],
		);
	});

	it("reports an export whose signature changes", () => {
		assert.deepEqual(
			breaksBetween(
				rootEntry,
				{
					"index.d.ts":
						"export declare function listThreads(accountId: string): Promise<string[]>;\n",
				},
				{
					"index.d.ts":
						"export declare function listThreads(accountId: string, limit: number): Promise<string[]>;\n",
				},
			),
			["changed . listThreads"],
		);
	});

	it("reports nothing for an addition", () => {
		assert.deepEqual(
			breaksBetween(
				rootEntry,
				{ "index.d.ts": "export declare const version: string;\n" },
				{
					"index.d.ts":
						"export declare const version: string;\nexport type ThreadId = string;\n",
				},
			),
			[],
		);
	});

	it("reports nothing for a reformatted or re-documented declaration", () => {
		assert.deepEqual(
			breaksBetween(
				rootEntry,
				{
					"index.d.ts": "export declare function send(to: string): void;\n",
				},
				{
					"index.d.ts":
						"/** Sends one message. */\nexport declare function send(\n\tto: string,\n): void;\n",
				},
			),
			[],
		);
	});

	it("follows re-exports into the module that declares them", () => {
		assert.deepEqual(
			breaksBetween(
				rootEntry,
				{
					"index.d.ts": 'export * from "./ports.js";\n',
					"ports.d.ts":
						"export interface MailPort { read(id: string): string; }\n",
				},
				{
					"index.d.ts": 'export * from "./ports.js";\n',
					"ports.d.ts":
						"export interface MailPort { read(id: number): string; }\n",
				},
			),
			["changed . MailPort"],
		);
	});

	it("expands a wildcard subpath over the files it matches", () => {
		const exports = {
			".": { types: "./dist/index.d.ts" },
			"./*": { types: "./dist/*.d.ts", default: "./dist/*.js" },
		};
		assert.deepEqual(
			breaksBetween(
				exports,
				{
					"dist/index.d.ts": "export declare const a: number;\n",
					"dist/errors.d.ts": "export declare class NotFound {}\n",
				},
				{ "dist/index.d.ts": "export declare const a: number;\n" },
			),
			["removed ./errors NotFound"],
		);
	});

	it("finds no API in a package without declarations", () => {
		const dir = writePackage(
			{ "./engine.mjs": "./engine.mjs", "./engine.wasm": "./engine.wasm" },
			{ "engine.mjs": "export const run = () => {};\n", "engine.wasm": "" },
		);
		assert.deepEqual(apiSurface(ts, dir), {
			exports: new Map(),
			unresolved: [],
		});
	});

	it("reports a changed signature in a package that ships source", () => {
		const exports = { ".": { types: "./src/index.ts" } };
		const index =
			'export { countThreads } from "./threads.js";\nexport const label = "threads";\n';
		assert.deepEqual(
			breaksBetween(
				exports,
				{
					"src/index.ts": index,
					"src/threads.ts":
						"export function countThreads(accountId: string) {\n\treturn accountId.length;\n}\n",
				},
				{
					"src/index.ts": index,
					"src/threads.ts":
						"export function countThreads(accountId: string, mailboxId: string) {\n\treturn accountId.length + mailboxId.length;\n}\n",
				},
			),
			["changed . countThreads"],
		);
	});

	it("reports nothing for a body change in a package that ships source", () => {
		const exports = { ".": { types: "./src/index.ts" } };
		assert.deepEqual(
			breaksBetween(
				exports,
				{
					"src/index.ts":
						"export function countThreads(accountId: string): number {\n\treturn accountId.length;\n}\n",
				},
				{
					"src/index.ts":
						"export function countThreads(accountId: string): number {\n\treturn accountId.trim().length;\n}\n",
				},
			),
			[],
		);
	});

	it("reports a change in an unexported type an export refers to", () => {
		assert.deepEqual(
			breaksBetween(
				rootEntry,
				{
					"index.d.ts":
						"type Opts = { a: string };\nexport declare function f(o: Opts): void;\nexport {};\n",
				},
				{
					"index.d.ts":
						"type Opts = { a: number };\nexport declare function f(o: Opts): void;\nexport {};\n",
				},
			),
			["changed (local) index.d.ts"],
		);
	});

	const sourceEntry = { ".": { types: "./src/index.ts" } };
	const resolved = {
		"src/index.ts": 'export const current = (): string => "session";\n',
	};
	const unresolvedImport = {
		"src/index.ts":
			'import { session } from "not-installed";\nexport const current = (): string => session();\n',
	};

	it("reports a minor when the published version no longer resolves", () => {
		assert.deepEqual(breaksBetween(sourceEntry, unresolvedImport, resolved), [
			"unresolved . not-installed",
		]);
	});

	it("fails instead of comparing through a fresh import it cannot resolve", () => {
		assert.throws(
			() => breaksBetween(sourceEntry, resolved, unresolvedImport),
			/unresolved in the fresh pack:\n {2}\. not-installed/,
		);
	});
});
