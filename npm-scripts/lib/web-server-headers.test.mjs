// What the runtime web server tells a browser about the files it hands over.
// The server sends neither ETag nor Last-Modified, so `no-cache` on it is not a
// revalidation — it is a full unconditional GET every time. The spellchecker's
// engine and dictionaries are megabytes fetched on every composer open, so
// which tree counts as immutable is the difference between one download and one
// per composer.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverPath = join(root, "docker", "runtime", "web", "server.mjs");

// The digest the spellcheck plugin names its staged directory after; any hex
// string does here, because what the server keys on is the tree, not the value.
const DIGEST = "0123456789abcdef";
const STAGED = `spellcheck/${DIGEST}`;

const dist = mkdtempSync(join(tmpdir(), "remit-web-dist-"));
let origin = "";
let child;

const write = (relative, body) => {
	const path = join(dist, relative);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body);
};

const freePort = () =>
	new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});

before(async () => {
	write("index.html", "<!doctype html><title>reader</title>");
	write("config.js", "window.__REMIT_CONFIG__ = {};\n");
	write("assets/app-2f9c1b.js", "export default 1;\n");
	write(`${STAGED}/hunspell.wasm`, "\0asm");
	write(`${STAGED}/license.hunspell`, "MPL-1.1 / GPL-2.0 / LGPL-2.1\n");
	write(`${STAGED}/dictionaries/nl/index.dic`, "2\nrapport\nklaar\n");
	write(`${STAGED}/dictionaries/nl/LICENSE`, "CC-BY-3.0\n");

	const port = await freePort();
	origin = `http://127.0.0.1:${port}`;
	child = spawn(process.execPath, [serverPath], {
		env: { ...process.env, WEB_DIST_DIR: dist, PORT: String(port) },
		stdio: ["ignore", "pipe", "inherit"],
	});
	await new Promise((resolve, reject) => {
		child.on("exit", (code) =>
			reject(new Error(`the web server exited with ${code} before listening`)),
		);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (line) => {
			if (line.includes("serving")) resolve();
		});
	});
});

after(() => {
	child?.kill();
	rmSync(dist, { recursive: true, force: true });
});

const head = async (path) => {
	const response = await fetch(`${origin}${path}`);
	assert.equal(response.status, 200, path);
	await response.arrayBuffer();
	return response.headers;
};

const IMMUTABLE = "public, max-age=31536000, immutable";

describe("caching the files a composer downloads", () => {
	it("holds the staged spellchecker for a year", async () => {
		assert.equal(
			(await head(`/${STAGED}/hunspell.wasm`)).get("cache-control"),
			IMMUTABLE,
		);
		assert.equal(
			(await head(`/${STAGED}/dictionaries/nl/index.dic`)).get("cache-control"),
			IMMUTABLE,
			"a dictionary re-fetched on every composer open is the whole download again",
		);
	});

	it("still holds vite's hashed assets for a year", async () => {
		assert.equal(
			(await head("/assets/app-2f9c1b.js")).get("cache-control"),
			IMMUTABLE,
		);
	});

	it("keeps the shell revalidated so a deploy is visible", async () => {
		assert.equal((await head("/index.html")).get("cache-control"), "no-cache");
	});
});

describe("reading a licence in a browser", () => {
	it("shows the dictionary's licence instead of downloading it", async () => {
		assert.equal(
			(await head(`/${STAGED}/dictionaries/nl/LICENSE`)).get("content-type"),
			"text/plain; charset=utf-8",
		);
	});

	it("shows the engine's licence too", async () => {
		assert.equal(
			(await head(`/${STAGED}/license.hunspell`)).get("content-type"),
			"text/plain; charset=utf-8",
		);
	});
});
