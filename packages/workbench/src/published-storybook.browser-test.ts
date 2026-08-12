/**
 * The published Storybook, exercised where it is actually published: under a
 * path prefix. GitHub Pages serves this build from `/reader/` and its pull
 * request previews from deeper still, and a URL the preview writes from the
 * document root resolves off that prefix and 404s. MSW is the one that bites —
 * its service worker fails to register, the loader rejects, and every story in
 * the index renders Storybook's error box instead of a component.
 *
 * The story suite next door serves Storybook at the root, so it agrees with a
 * root-absolute URL and cannot see this. Hence a second lane that builds the
 * static output the deploy builds and serves it behind a prefix.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, relative, resolve, sep } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "playwright";

const workbench = fileURLToPath(new URL("..", import.meta.url));
const output = join(workbench, "storybook-static");

// Deep enough to catch a URL that is right only one segment up, which is the
// shape a pull request preview is published under.
const prefix = "/reader/pr/1234";

const mimeTypes: Record<string, string> = {
	".css": "text/css",
	".html": "text/html",
	".js": "text/javascript",
	".json": "application/json",
	".map": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
	".woff2": "font/woff2",
};

const buildStorybook = (): Promise<void> =>
	new Promise((settle, fail) => {
		const build = spawn("npm", ["run", "build-storybook"], {
			cwd: workbench,
			stdio: "inherit",
		});
		build.on("error", fail);
		build.on("exit", (code) =>
			code === 0
				? settle()
				: fail(new Error(`build-storybook exited with ${code}`)),
		);
	});

/**
 * Pages, near enough: the build under a prefix, and nothing outside it.
 */
const servePrefixed = (): Promise<Server> => {
	const server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		if (path !== prefix && !path.startsWith(`${prefix}/`)) {
			response.writeHead(404).end("outside the deploy prefix");
			return;
		}

		const within = path.slice(prefix.length) || "/";
		const file = resolve(
			output,
			`.${within.endsWith("/") ? `${within}index.html` : within}`,
		);
		const escapes = relative(output, file).startsWith(`..${sep}`);
		if (escapes) {
			response.writeHead(403).end("outside the build");
			return;
		}

		readFile(file).then(
			(body) => {
				response.writeHead(200, {
					"content-type":
						mimeTypes[extname(file)] ?? "application/octet-stream",
				});
				response.end(body);
			},
			() => response.writeHead(404).end("not in the build"),
		);
	});
	return new Promise((settle) =>
		server.listen(0, "127.0.0.1", () => settle(server)),
	);
};

type StoryIndex = {
	entries: Record<string, { id: string; title: string; type: string }>;
};

const storiesToLoad = async (): Promise<readonly string[]> => {
	const index = JSON.parse(
		await readFile(join(output, "index.json"), "utf8"),
	) as StoryIndex;
	const stories = Object.values(index.entries).filter(
		(entry) => entry.type === "story",
	);
	const first = stories[0];
	const flow = stories.find((entry) => entry.title.startsWith("Flows/"));
	assert.ok(first, "the built index holds no stories");
	assert.ok(flow, "the built index holds no flow stories");
	return [first.id, flow.id];
};

describe("the Storybook build published under a path prefix", () => {
	let server: Server;
	let browser: Browser;
	let origin: string;

	before(async () => {
		await buildStorybook();
		server = await servePrefixed();
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		browser = await chromium.launch();
	});

	after(async () => {
		await browser?.close();
		await new Promise((settle) => server?.close(settle) ?? settle(undefined));
	});

	it("registers MSW's worker and renders its stories", async () => {
		for (const id of await storiesToLoad()) {
			// Its own context per story: a service worker registered by one page
			// would otherwise stay active and answer for the next.
			const context = await browser.newContext();
			const page = await context.newPage();
			const missed: string[] = [];
			page.on("response", (response) => {
				if (response.status() >= 400)
					missed.push(`${response.status()} ${response.url()}`);
			});

			await page.goto(`${origin}${prefix}/iframe.html?id=${id}&viewMode=story`);
			await page.waitForFunction(
				() =>
					document.body.classList.contains("sb-show-errordisplay") ||
					(document.querySelector("#storybook-root")?.childElementCount ?? 0) >
						0,
				undefined,
				{ timeout: 60_000 },
			);

			const failure = await page.evaluate(() =>
				document.body.classList.contains("sb-show-errordisplay")
					? `${document.querySelector("#error-message")?.textContent ?? ""} ${document.querySelector("#error-stack")?.textContent ?? ""}`.trim()
					: "",
			);
			assert.equal(
				failure,
				"",
				`${id} failed to render under ${prefix}\n${failure}\nrequests that missed:\n${missed.join("\n")}`,
			);

			const worker = await page.evaluate(async () => {
				const registration = await navigator.serviceWorker.getRegistration();
				return (
					registration?.active?.scriptURL ??
					registration?.installing?.scriptURL ??
					""
				);
			});
			assert.equal(
				worker,
				`${origin}${prefix}/mockServiceWorker.js`,
				`${id} registered no MSW worker under ${prefix}; requests that missed:\n${missed.join("\n")}`,
			);

			await context.close();
		}
	});
});
