/**
 * Dev-stage parity capture (PARITY_TARGET=dev).
 *
 * Captures the parity states that the local seeded backend can't reach because
 * Cognito is bypassed locally (the app short-circuits to the inbox instead of
 * rendering the Amplify Authenticator). See issue #855 (epic #819).
 *
 * What it does:
 *   - Starts the web-client Vite dev server pointed at the dev stage. Vite
 *     auto-loads packages/remit-web-client/.env.local, which wires VITE_API_URL
 *     + VITE_COGNITO_* at the real dev API / user pool. Generate it first with:
 *       npm run web-client:env -- --stage dev
 *   - auth/sign-in: navigates to /mail while signed-out and screenshots the real
 *     Cognito-backed Amplify sign-in card (no local-dev banner). Captured for
 *     every viewport × theme.
 *   - onboarding/*: signs in once as the provisioned dev test user
 *     (REMIT_DEV_TEST_USER / REMIT_DEV_TEST_PASSWORD from the gitignored .envrc,
 *     written by `npm run provision:dev-test-user -- --stage dev`), then drives
 *     the onboarding wizard to each sub-state and screenshots it. These reuse the
 *     manifest's onboarding rows + steps verbatim.
 *
 * Output path convention is identical to the local capture
 * (capture-parity.ts): tmp/parity/<surface>/<state>__<viewport>__<theme>.live.png
 * so the montage/report tooling treats dev-captured live sides the same.
 *
 * Prerequisites (run from repo root):
 *   npm run web-client:env -- --stage dev            # writes .env.local
 *   npm run provision:dev-test-user -- --stage dev   # writes .envrc creds
 *
 * Run via:
 *   npm run parity:capture:dev -w packages/remit-web-client
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "@playwright/test";
import { manifest, type ParityRow, type Viewport } from "./parity.manifest.ts";

const __filename = fileURLToPath(import.meta.url);
const PKG_ROOT = resolve(dirname(__filename), "../..");
const REPO_ROOT = resolve(PKG_ROOT, "../..");

const OUT_ROOT = resolve(REPO_ROOT, "tmp", "parity");

// The dev API Gateway only allows Access-Control-Allow-Origin
// https://dev.remit.email, so every cross-origin fetch from localhost is
// blocked by CORS and the app renders only skeletons. We are capturing UI, not
// testing CORS, so disable web security for the capture browser — exactly what
// the deployed origin would see, minus the browser's origin check.
const BROWSER_ARGS = [
	"--disable-web-security",
	"--disable-features=IsolateOrigins,site-per-process",
];

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

const VIEWPORT_SIZES: Record<Viewport, { width: number; height: number }> = {
	phone: { width: 390, height: 844 },
	tablet: { width: 768, height: 1024 },
	desktop: { width: 1440, height: 900 },
};

const ensureDir = async (dir: string): Promise<void> => {
	await mkdir(dir, { recursive: true });
};

const outPath = (
	surface: string,
	state: string,
	viewport: Viewport,
	theme: Theme,
): string =>
	resolve(OUT_ROOT, surface, `${state}__${viewport}__${theme}.live.png`);

/** Read REMIT_DEV_TEST_USER / REMIT_DEV_TEST_PASSWORD from the gitignored .envrc. */
const readDevCredentials = async (): Promise<{
	email: string;
	password: string;
}> => {
	const envrcPath = resolve(REPO_ROOT, ".envrc");
	let body: string;
	try {
		body = await readFile(envrcPath, "utf8");
	} catch {
		throw new Error(
			`.envrc not found at ${envrcPath}. Run: npm run provision:dev-test-user -- --stage dev`,
		);
	}
	const read = (key: string): string => {
		const match = body.match(new RegExp(`^export ${key}=(.*)$`, "m"));
		if (!match) {
			throw new Error(
				`${key} missing from .envrc. Run: npm run provision:dev-test-user -- --stage dev`,
			);
		}
		// Value is JSON-stringified by the provisioner.
		return JSON.parse(match[1]) as string;
	};
	return {
		email: read("REMIT_DEV_TEST_USER"),
		password: read("REMIT_DEV_TEST_PASSWORD"),
	};
};

/** Live base URL for the spawned Vite server; set by startVite(). */
let LIVE_BASE = "";

/** Find a free TCP port so we never collide with a stale Vite from another
 * worktree (the squatting-server bug: a leftover Vite serving the local seed
 * would be screenshotted instead of the dev-stage app). */
const findFreePort = (): Promise<number> =>
	new Promise((resolvePort, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				const { port } = addr;
				server.close(() => resolvePort(port));
			} else {
				reject(new Error("could not determine a free port"));
			}
		});
	});

/** Start the web-client Vite dev server on a private free port (detached,
 * headless). `--strictPort` makes Vite exit rather than silently hop to
 * another port, so we never end up screenshotting the wrong server. Resolves
 * once Vite reports ready on the expected port. */
const startVite = async (): Promise<{ stop: () => void }> => {
	const port = await findFreePort();
	LIVE_BASE = `http://localhost:${port}`;
	const child = spawn(
		"npx",
		["vite", "--port", String(port), "--strictPort", "--host", "0.0.0.0"],
		{
			cwd: PKG_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env },
		},
	);
	child.stdout?.on("data", (d) => process.stdout.write(`[vite] ${d}`));
	child.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));

	await new Promise<void>((resolveReady, reject) => {
		const deadline = setTimeout(
			() => reject(new Error("Vite did not become ready within 60s")),
			60_000,
		);
		const onData = (data: Buffer): void => {
			if (data.toString().includes(`localhost:${port}`)) {
				clearTimeout(deadline);
				resolveReady();
			}
		};
		child.stdout?.on("data", onData);
		child.on("exit", (code) => {
			clearTimeout(deadline);
			reject(new Error(`Vite exited before becoming ready (code ${code})`));
		});
	});

	return {
		stop: () => {
			child.kill("SIGTERM");
		},
	};
};

const newContextPage = async (
	browser: Browser,
	viewport: Viewport,
	theme: Theme,
): Promise<{ page: Page; close: () => Promise<void> }> => {
	const context = await browser.newContext({
		viewport: VIEWPORT_SIZES[viewport],
		colorScheme: theme === "dark" ? "dark" : "light",
	});
	await context.addInitScript((t) => {
		localStorage.setItem("remit.theme", t);
	}, theme);
	const page = await context.newPage();
	return { page, close: () => context.close() };
};

const screenshot = async (
	page: Page,
	surface: string,
	state: string,
	viewport: Viewport,
	theme: Theme,
): Promise<void> => {
	const dest = outPath(surface, state, viewport, theme);
	await ensureDir(dirname(dest));
	const shot = await page.screenshot({ fullPage: false });
	await writeFile(dest, shot);
	console.log(`  captured live → ${dest.replace(`${REPO_ROOT}/`, "")}`);
};

/** Sign in via the Amplify Authenticator form (email + password). */
const signIn = async (
	page: Page,
	email: string,
	password: string,
): Promise<void> => {
	await page.goto(`${LIVE_BASE}/mail`);
	// The Authenticator labels the field "Username" (the pool uses email as the
	// username attribute), rendered as input[name='username'].
	const emailField = page.locator("input[name='username']").first();
	await emailField.waitFor({ state: "visible", timeout: 30_000 });
	await emailField.fill(email);
	await page.locator("input[type='password']").first().fill(password);
	// Click the form's submit button only — `button:has-text('Sign in')` would
	// also match the "Sign In" tab, which never submits the form.
	await page
		.locator("button[type='submit']:has-text('Sign in')")
		.first()
		.click();
	// Authenticated shell renders the app — wait until the sign-in form is gone.
	await page
		.locator("input[type='password']")
		.first()
		.waitFor({ state: "detached", timeout: 30_000 });
};

const runStep = async (
	page: Page,
	step: NonNullable<ParityRow["live"]["steps"]>[number],
): Promise<boolean> => {
	const STEP_TIMEOUT = 5_000;
	try {
		if (step.action === "click") {
			await page
				.locator(step.selector)
				.first()
				.click({ timeout: STEP_TIMEOUT, force: true });
		} else if (step.action === "fill") {
			await page
				.locator(step.selector)
				.first()
				.fill(step.value, { timeout: STEP_TIMEOUT });
		} else if (step.action === "wait") {
			await page
				.locator(step.selector)
				.first()
				.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
		}
		return true;
	} catch {
		return false;
	}
};

const captureSignIn = async (browser: Browser): Promise<void> => {
	console.log("[auth/sign-in] (real Cognito Amplify card)");
	for (const viewport of ["phone", "tablet", "desktop"] as Viewport[]) {
		for (const theme of THEMES) {
			const { page, close } = await newContextPage(browser, viewport, theme);
			try {
				await page.goto(`${LIVE_BASE}/mail`);
				await page
					.locator("input[type='password']")
					.first()
					.waitFor({ state: "visible", timeout: 30_000 });
				await page.waitForTimeout(400);
				await screenshot(page, "auth", "sign-in", viewport, theme);
			} finally {
				await close();
			}
		}
	}
};

const captureOnboarding = async (
	browser: Browser,
	email: string,
	password: string,
): Promise<number> => {
	const onboardingRows = manifest.filter((r) => r.surface === "onboarding");
	let flagged = 0;
	for (const row of onboardingRows) {
		console.log(`[onboarding/${row.state}]`);
		for (const viewport of row.viewports) {
			for (const theme of THEMES) {
				const { page, close } = await newContextPage(browser, viewport, theme);
				try {
					await signIn(page, email, password);
					await page.goto(`${LIVE_BASE}${row.live.route}`);
					await page
						.waitForLoadState("networkidle", { timeout: 10_000 })
						.catch(() => {});
					let stepsFailed = false;
					for (const step of row.live.steps ?? []) {
						const ok = await runStep(page, step);
						if (!ok) {
							console.warn(
								`  ⚠ step skipped (selector not found): ${step.action} ${step.selector}`,
							);
							stepsFailed = true;
							break;
						}
					}
					await page.waitForTimeout(300);
					await screenshot(page, "onboarding", row.state, viewport, theme);
					if (stepsFailed) flagged++;
				} finally {
					await close();
				}
			}
		}
	}
	return flagged;
};

const run = async (): Promise<void> => {
	console.log("Parity capture — dev stage (PARITY_TARGET=dev)");
	console.log(`Output root: ${OUT_ROOT}`);
	console.log();

	const { email, password } = await readDevCredentials();

	const vite = await startVite();
	let browser: Browser | undefined;
	try {
		console.log(`Live base: ${LIVE_BASE}`);
		browser = await chromium.launch({ args: BROWSER_ARGS });

		await captureSignIn(browser);
		const flagged = await captureOnboarding(browser, email, password);

		console.log();
		console.log(
			`Done. ${flagged} onboarding captures flagged (step selector not found).`,
		);
		console.log(`Output: ${OUT_ROOT}`);
	} finally {
		if (browser) await browser.close();
		vite.stop();
	}
};

run().catch((err) => {
	console.error("parity:capture:dev failed:", err);
	process.exit(1);
});
