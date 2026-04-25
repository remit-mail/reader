import { defineConfig, devices } from "@playwright/test";

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
		baseURL: "http://localhost:5173",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	expect: {
		toHaveScreenshot: {
			// Tolerate small drift from font rendering and from the seeded
			// `NOW = Date.now()` re-computing on each global-setup run
			// (which shifts relative-time labels like "Yesterday" /
			// "8:01 AM"). Real layout regressions are usually 10%+ of
			// pixels, so 5% catches them while absorbing the noise.
			// TODO: drop to 1% once the seeder uses a fixed clock — see
			// `visual-regression/README.md` for follow-up.
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
	webServer: [
		{
			command:
				"node --env-file=../../.e2e.env --import tsx ../../packages/remit-backend/dev-server/server.ts",
			port: 5433,
			reuseExistingServer: !process.env.CI,
			env: {
				DYNAMODB_PORT: "5435",
				DYNAMODB_TABLE_NAME: "remit-test",
				SERVER_PORT: "5433",
				KMS_KEY_ID: "FAKE_KMS_KEY_ID",
				FAKE_KMS_DATAKEY: "8AD6A6C8-B5E2-488F-B017-96B662DC01AC",
				SQS_QUEUE_URL: "http://localhost:9324/000000000000/remit-e2e-noop",
				STORAGE_LOCAL_PATH: ".remit/e2e-storage",
				LOCAL_ACCOUNT_CONFIG_ID: "5kkksa64jz6z9jfjuxbu7pckd",
				NODE_ENV: "test",
				AWS_REGION: "not-a-region",
				AWS_ACCESS_KEY_ID: "local",
				AWS_SECRET_ACCESS_KEY: "local",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			command: "npx vite --port 5173",
			port: 5173,
			reuseExistingServer: !process.env.CI,
			stdout: "pipe",
			stderr: "pipe",
		},
	],
});
