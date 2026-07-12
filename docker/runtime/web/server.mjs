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
import { stat } from "node:fs/promises";
import http from "node:http";
import { extname, join, normalize, sep } from "node:path";

const DIST_DIR = process.env.WEB_DIST_DIR ?? "/app/dist";
const PORT = Number(process.env.PORT ?? "8080");

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

const send = (res, status, filePath, cacheControl) => {
	res.writeHead(status, {
		"Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
		"Cache-Control": cacheControl,
	});
	createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" }).end(
			JSON.stringify({ status: "ok" }),
		);
		return;
	}

	const requested = resolveSafePath(req.url ?? "/");
	if (!requested) {
		res.writeHead(400).end("bad request");
		return;
	}

	const looksLikeFile = extname(requested) !== "";
	const candidate = requested.endsWith("/") ? join(requested, "index.html") : requested;

	try {
		const info = await stat(candidate);
		if (info.isFile()) {
			// Hashed assets (dist/assets/*) are immutable; index.html and other
			// top-level files are revalidated every time so a deploy is visible
			// without a hard refresh.
			const cacheControl = candidate.includes(`${sep}assets${sep}`)
				? "public, max-age=31536000, immutable"
				: "no-cache";
			send(res, 200, candidate, cacheControl);
			return;
		}
	} catch {
		// fall through to SPA fallback below
	}

	if (looksLikeFile) {
		res.writeHead(404).end("not found");
		return;
	}

	send(res, 200, join(DIST_DIR, "index.html"), "no-cache");
});

server.listen(PORT, "0.0.0.0", () => {
	console.log(`web: serving ${DIST_DIR} on :${PORT}`);
});
