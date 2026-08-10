#!/usr/bin/env node
import {
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
// Replaces the staged engine and dictionaries with their brotli form. Only the
// compressed file lands in the image and it is served with `Content-Encoding:
// br`, so the browser receives the upstream bytes unchanged — the served form
// is still the source, which is what discharges every GPL and MPL
// source-correspondence obligation on a dictionary.
//
// Uncompressed, fifteen dictionaries are 36 MB against 7.9 MB brotli. Doing it
// here rather than per request also keeps a small VM from re-compressing a file
// that never changes.
import { brotliCompressSync, constants } from "node:zlib";

const COMPRESSIBLE = /\.(wasm|mjs|aff|dic)$/;

const walk = (directory) =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});

const run = (root) => {
	let before = 0;
	let after = 0;
	for (const path of walk(root)) {
		if (!COMPRESSIBLE.test(path)) continue;
		const raw = readFileSync(path);
		const packed = brotliCompressSync(raw, {
			params: {
				[constants.BROTLI_PARAM_QUALITY]: 11,
				[constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
			},
		});
		writeFileSync(`${path}.br`, packed);
		rmSync(path);
		before += raw.byteLength;
		after += packed.byteLength;
	}
	const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
	console.log(`spellcheck: ${kb(before)} raw → ${kb(after)} brotli in ${root}`);
};

const root = process.argv[2] ?? "packages/web-client/dist/spellcheck";
if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
	console.log(`spellcheck: nothing staged at ${root}`);
	process.exit(0);
}
run(root);
