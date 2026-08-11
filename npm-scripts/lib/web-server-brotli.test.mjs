// The web image's static server, exercised as a running server rather than as a
// module. It has no exports and no injection seam — it reads its environment,
// binds a port and serves a directory — so the only honest way to ask what it
// does with a precompressed file is to start one and fetch from it.
//
// The spellchecker is why that path exists. Its engine and dictionaries are
// stored brotli and never stored any other way, because brotli is transport and
// the bytes a browser receives have to be the upstream source for every GPL and
// MPL dictionary in the image. A client that does not accept brotli still has to
// get those bytes, or the composer's spellchecker is dead on an old browser
// while every other asset works.
//
// What the same server puts in the headers — which tree is immutable, and what
// a licence file is typed as — is web-server-headers.test.mjs beside this one.
// Both live here rather than beside the server because this is where the runner
// CI reaches collects its suites, and neither needs anything installed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { brotliCompressSync } from "node:zlib";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverPath = join(repoRoot, "docker", "runtime", "web", "server.mjs");

const WASM = Buffer.from(
	"\0asm\0\0\0 a wasm file long enough that brotli beats it".repeat(40),
);
const DICTIONARY = Buffer.from("kwestie\nvergadering\nbegroting\n".repeat(200));
const PLAIN = Buffer.from("<!doctype html><title>reader</title>");

const freePort = () =>
	new Promise((resolve, reject) => {
		const probe = createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});

const reachable = async (url) => {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		// A refused connection is the server not listening yet, which is the
		// ordinary case for the first few attempts.
		const answer = await fetch(url).catch(() => null);
		if (answer?.ok) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`${url} never came up`);
};

describe("the web image serves what it stores", () => {
	let dist;
	let child;
	let origin;

	before(async () => {
		dist = mkdtempSync(join(tmpdir(), "web-dist-"));
		mkdirSync(join(dist, "spellcheck", "dictionaries", "nl"), {
			recursive: true,
		});
		writeFileSync(join(dist, "index.html"), PLAIN);
		writeFileSync(
			join(dist, "spellcheck", "hunspell.wasm.br"),
			brotliCompressSync(WASM),
		);
		writeFileSync(
			join(dist, "spellcheck", "dictionaries", "nl", "index.dic.br"),
			brotliCompressSync(DICTIONARY),
		);

		const port = await freePort();
		origin = `http://127.0.0.1:${port}`;
		child = spawn(process.execPath, [serverPath], {
			env: { ...process.env, WEB_DIST_DIR: dist, PORT: String(port) },
			stdio: "ignore",
		});
		await reachable(`${origin}/health`);
	});

	after(() => {
		child?.kill();
		rmSync(dist, { recursive: true, force: true });
	});

	it("hands a brotli client the stored file untouched", async () => {
		const answer = await fetch(`${origin}/spellcheck/hunspell.wasm`, {
			headers: { "accept-encoding": "br" },
		});
		assert.equal(answer.status, 200);
		assert.equal(answer.headers.get("content-encoding"), "br");
		// The type is the file's own, not the container's: a browser handed
		// `application/x-brotli` would refuse to instantiate the module.
		assert.equal(answer.headers.get("content-type"), "application/wasm");
		assert.equal(answer.headers.get("vary"), "Accept-Encoding");
		assert.deepEqual(Buffer.from(await answer.arrayBuffer()), WASM);
	});

	// The reason the file is not simply served as-is to everyone. A browser
	// without brotli would otherwise get a 404 and a composer whose spellchecker
	// never starts, on a build that carries the dictionary perfectly well.
	it("decompresses for a client that cannot take brotli", async () => {
		const answer = await fetch(
			`${origin}/spellcheck/dictionaries/nl/index.dic`,
			{ headers: { "accept-encoding": "identity" } },
		);
		assert.equal(answer.status, 200);
		assert.equal(answer.headers.get("content-encoding"), null);
		assert.equal(
			answer.headers.get("content-type"),
			"text/plain; charset=utf-8",
		);
		assert.deepEqual(Buffer.from(await answer.arrayBuffer()), DICTIONARY);
	});

	it("leaves an ordinary file alone", async () => {
		const answer = await fetch(`${origin}/index.html`, {
			headers: { "accept-encoding": "br" },
		});
		assert.equal(answer.status, 200);
		assert.equal(answer.headers.get("content-encoding"), null);
		assert.deepEqual(Buffer.from(await answer.arrayBuffer()), PLAIN);
	});

	// A dictionary this build never staged must answer 404, which is what the
	// composer turns into a named failure with the browser's checker back on.
	// The SPA fallback must not hand it index.html instead.
	it("does not invent a dictionary it never stored", async () => {
		const answer = await fetch(
			`${origin}/spellcheck/dictionaries/de/index.dic`,
			{ headers: { "accept-encoding": "br" } },
		);
		assert.equal(answer.status, 404);
	});
});
