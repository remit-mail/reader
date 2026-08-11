#!/usr/bin/env node
// Static file server for the vite-built web client. No framework, no
// dependencies — the dist/ tree this serves is already the entire build
// output, so a bespoke ~80-line server keeps the image from carrying a
// static-file-server npm package it doesn't need.
//
// SPA fallback: any request that isn't an existing file under dist/ and
// doesn't look like a file (no extension in its last path segment) serves
// index.html, so client-side routes (TanStack Router) resolve on refresh.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { basename, extname, join, normalize, sep } from "node:path";
import { createBrotliDecompress } from "node:zlib";

const DIST_DIR = process.env.WEB_DIST_DIR ?? "/app/dist";
const PORT = Number(process.env.PORT ?? "8080");

// dist/config.js is whatever this image was built with (packages/web-client's
// build-time default, or a --auth cognito build's own values) — not something
// this server should overwrite, since that would silently drop every field it
// doesn't know about and turn a write failure (read-only dist/) into a crash
// before `listen`. TLS_MODE is the one value this container's own environment
// knows that the build did not, chosen per-deployment in .env at `docker
// compose up` time; append it to the baked config in memory and serve
// `/config.js` from there instead of touching disk.
const bakedConfig = await readFile(join(DIST_DIR, "config.js"), "utf8").catch(
	() => "window.__REMIT_CONFIG__ = {};\n",
);
const CONFIG_JS = `${bakedConfig}\nwindow.__REMIT_CONFIG__.tlsMode = ${JSON.stringify(process.env.TLS_MODE ?? "off")};\n`;

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".map": "application/json; charset=utf-8",
	".wasm": "application/wasm",
	".aff": "text/plain; charset=utf-8",
	".dic": "text/plain; charset=utf-8",
};

// Licence texts carry no extension a MIME table can key on — `LICENSE` beside
// every dictionary, `license.hunspell` beside the engine — and served as
// octet-stream a browser downloads them instead of showing them, which is the
// wrong answer to someone checking what this image carries.
const isLicence = (name) => /^licen[cs]e/i.test(name);

const IMMUTABLE_TREES = ["assets", "spellcheck"];

const contentTypeOf = (filePath) => {
	const name = basename(filePath);
	return (
		MIME_TYPES[extname(filePath)] ??
		(isLicence(name) ? MIME_TYPES[".txt"] : "application/octet-stream")
	);
};

const resolveSafePath = (urlPath) => {
	let decoded;
	try {
		decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
	} catch {
		return null; // malformed percent-encoding (e.g. "/%ZZ")
	}
	const normalized = normalize(join(DIST_DIR, decoded));
	if (normalized !== DIST_DIR && !normalized.startsWith(DIST_DIR + sep)) {
		return null; // path traversal attempt
	}
	return normalized;
};

// Stats before writing anything, so a stream open failure (file gone between
// the check and the read, dist/ unmounted) never lands after headers are
// already committed — that left a missing SPA-fallback index.html crashing
// the process on an unhandled stream error instead of answering a clean 500,
// turning what should be a healthcheck failure into a restart loop.
//
// A file that exists only as `<name>.br` is a precompressed asset — the
// spellchecker's engine and dictionaries, which are stored compressed and
// never stored any other way. Brotli is transport here: a client that accepts
// it gets the bytes as they sit on disk, and one that does not gets them
// decompressed rather than a 404, because the alternative is a composer with a
// dead spellchecker on an old browser.
const serveFile = async (res, filePath, cacheControl, acceptEncoding = "") => {
	let info;
	try {
		info = await stat(filePath);
	} catch {
		info = null;
	}

	let path = filePath;
	let precompressed = false;
	if (!info?.isFile()) {
		try {
			const packed = await stat(`${filePath}.br`);
			if (!packed.isFile()) return false;
			path = `${filePath}.br`;
			precompressed = true;
		} catch {
			return false;
		}
	}

	const wantsBrotli = acceptEncoding.includes("br");
	const stream = createReadStream(path);
	stream.on("error", () => {
		if (res.headersSent) res.destroy();
		else res.writeHead(500).end("internal server error");
	});
	res.writeHead(200, {
		"Content-Type": contentTypeOf(filePath),
		"Cache-Control": cacheControl,
		...(precompressed && wantsBrotli ? { "Content-Encoding": "br" } : {}),
		Vary: "Accept-Encoding",
	});
	if (precompressed && !wantsBrotli) {
		const inflate = createBrotliDecompress();
		inflate.on("error", () => res.destroy());
		stream.pipe(inflate).pipe(res);
		return true;
	}
	stream.pipe(res);
	return true;
};

const server = http.createServer(async (req, res) => {
	if (req.url === "/health") {
		res
			.writeHead(200, { "Content-Type": "application/json" })
			.end(JSON.stringify({ status: "ok" }));
		return;
	}

	if (req.url === "/config.js") {
		res
			.writeHead(200, {
				"Content-Type": MIME_TYPES[".js"],
				"Cache-Control": "no-cache",
			})
			.end(CONFIG_JS);
		return;
	}

	const requested = resolveSafePath(req.url ?? "/");
	if (!requested) {
		res.writeHead(400).end("bad request");
		return;
	}

	const looksLikeFile = extname(requested) !== "";
	const candidate = requested.endsWith("/")
		? join(requested, "index.html")
		: requested;

	// Content-addressed trees are immutable; index.html and other top-level
	// files are revalidated every time so a deploy is visible without a hard
	// refresh. Two trees qualify: vite's hashed assets, and dist/spellcheck/,
	// where the engine and every dictionary sit under a directory named for the
	// digest of their own bytes. This server sends neither ETag nor
	// Last-Modified, so anything outside them is fetched whole every time — for
	// a 2.4 MB dictionary that meant re-downloading it on every composer open.
	const cacheControl = IMMUTABLE_TREES.some((tree) =>
		candidate.includes(`${sep}${tree}${sep}`),
	)
		? "public, max-age=31536000, immutable"
		: "no-cache";
	const acceptEncoding = req.headers["accept-encoding"] ?? "";
	if (await serveFile(res, candidate, cacheControl, acceptEncoding)) return;

	if (looksLikeFile) {
		res.writeHead(404).end("not found");
		return;
	}

	if (await serveFile(res, join(DIST_DIR, "index.html"), "no-cache")) return;
	res.writeHead(500).end("internal server error");
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`web: serving ${DIST_DIR} on :${PORT}`);
});
