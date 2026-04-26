import { defineConfig, devices } from "@playwright/test";

// Ports the visual suite owns. Default to the smoke harness defaults
// (5173 / 5433) so a fresh checkout works with no env tweaking. Local
// dev with another Vite running on 5173 should override these — for
// example `VISUAL_VITE_PORT=5176 VISUAL_BACKEND_PORT=5436 npm run …`.
const VITE_PORT = Number.parseInt(process.env.VISUAL_VITE_PORT ?? "5173", 10);
const BACKEND_PORT = Number.parseInt(
	process.env.VISUAL_BACKEND_PORT ?? "5433",
	10,
);

// Fixed clock for the visual-regression seeder. The seeder
// (`smoke/global-setup.ts`) reads `REMIT_FAKE_NOW` (epoch ms) and uses
// it for every seeded `sentDate` / `internalDate`, which freezes the
// relative-time labels ("Yesterday", "8:01 AM", …) so baselines stay
// byte-stable across runs.
//
// Hardcoded literal (do not call `Date.UTC()` here — the literal stays
// visible in diffs):
//   1774008000000 === Date.UTC(2026, 3, 1, 10, 0, 0) === 2026-04-01T10:00:00Z
const REMIT_FAKE_NOW = "1774008000000";

// Export to the Playwright runner's environment so `globalSetup`
// (which runs in this same process) sees it. We also pass it on the
// `webServer` env below so any backend code reading the same flag
// agrees on the timestamp.
process.env.REMIT_FAKE_NOW ??= REMIT_FAKE_NOW;

/**
 * Visual regression suite. Captures screenshots of the key Remit routes
 * at three viewports — phone (iPhone-13: 390×844), tablet (iPad-mini:
 * 768×1024), and desktop (1440×900) — and compares them against
 * baselines that live on the `visual-baselines` orphan branch.
 *
 * `visual-regression/__screenshots__` is a symlink into
 * `<repo-root>/.visual-baselines/...` populated by
 * `scripts/visual-baselines.sh fetch`. The npm scripts wire this up
 * automatically — see `package.json` and `visual-regression/README.md`.
 *
 * Reuses the smoke harness's web-server config so the same dev-server
 * + backend stack is started automatically.
 *
 * Run the suite (fetches baselines first):
 *   npm run test:visual -w packages/remit-web-client
 *
 * Regenerate baselines locally after an intended visual change:
 *   npm run test:visual:update  -w packages/remit-web-client
 *   npm run test:visual:publish -w packages/remit-web-client
 */
export default defineConfig({
	testDir: "./visual-regression",
	// All baselines live under `visual-regression/__screenshots__/...`,
	// which is a symlink into the orphan-branch cache. The default
	// template would scatter PNGs into per-spec sibling dirs like
	// `signin.spec.ts-snapshots/`, which the symlink can't redirect.
	snapshotPathTemplate:
		"{testDir}/__screenshots__/{testFileName}/{projectName}/{arg}{ext}",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? "github" : "html",
	timeout: 30_000,
	globalSetup: "./smoke/global-setup.ts",
	use: {
		baseURL: `http://localhost:${VITE_PORT}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	expect: {
		toHaveScreenshot: {
			// The seeder runs against a fixed clock (REMIT_FAKE_NOW, set
			// on the webServer env below) so timestamp-driven labels are
			// byte-stable. The residual noise is font-metric drift
			// between local-capture Chromium (macOS / Ubuntu desktop) and
			// CI-assert Chromium (Ubuntu runner): on the same string the
			// wrap-point shifts by a pixel or two, which cascades into
			// every text row below it. The fixed-clock fix above is the
			// substantive change in this PR; threshold stays at 5%
			// (matching the previous gate) until baselines can be
			// captured on CI itself — see `visual-regression/README.md`.
			maxDiffPixelRatio: 0.05,
			animations: "disabled",
		},
	},
	projects: [
		{
			name: "phone",
			use: {
				...devices["iPhone 13"],
				// `iPhone 13` defaults to webkit; pin to chromium so a single
				// browser engine covers all three projects (CI installs
				// chromium only).
				browserName: "chromium",
				defaultBrowserType: "chromium",
				viewport: { width: 390, height: 844 },
			},
		},
		{
			name: "tablet",
			use: {
				...devices["iPad Mini"],
				browserName: "chromium",
				defaultBrowserType: "chromium",
				viewport: { width: 768, height: 1024 },
			},
		},
		{
			name: "desktop",
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1440, height: 900 },
			},
		},
	],
	// `reuseExistingServer: false` everywhere — reusing a Vite from
	// another worktree silently captures the wrong codebase. Stop
	// other dev servers on ports 5173/5433 before running this suite.
	webServer: [
		{
			command:
				"node --env-file=../../.e2e.env --import tsx ../../packages/remit-backend/dev-server/server.ts",
			port: BACKEND_PORT,
			reuseExistingServer: false,
			env: {
				DYNAMODB_PORT: "5435",
				DYNAMODB_TABLE_NAME: "remit-test",
				SERVER_PORT: String(BACKEND_PORT),
				KMS_KEY_ID: "FAKE_KMS_KEY_ID",
				FAKE_KMS_DATAKEY: "8AD6A6C8-B5E2-488F-B017-96B662DC01AC",
				SQS_QUEUE_URL: "http://localhost:9324/000000000000/remit-e2e-noop",
				STORAGE_LOCAL_PATH: ".remit/e2e-storage",
				LOCAL_ACCOUNT_CONFIG_ID: "5kkksa64jz6z9jfjuxbu7pckd",
				NODE_ENV: "test",
				AWS_REGION: "not-a-region",
				AWS_ACCESS_KEY_ID: "local",
				AWS_SECRET_ACCESS_KEY: "local",
				REMIT_FAKE_NOW,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			command: `npx vite --port ${VITE_PORT}`,
			port: VITE_PORT,
			reuseExistingServer: false,
			env: {
				VITE_PROXY_BACKEND_PORT: String(BACKEND_PORT),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	],
});
