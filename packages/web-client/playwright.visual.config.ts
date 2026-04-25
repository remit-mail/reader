import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression suite. Captures screenshots of the key Remit routes
 * at three viewports — phone (iPhone-13: 390×844), tablet (iPad-mini:
 * 768×1024), and desktop (1440×900) — and compares them against
 * baselines committed under `visual-regression/__screenshots__/`.
 *
 * Reuses the smoke harness's web-server config so the same dev-server
 * + backend stack is started automatically.
 *
 * To regenerate baselines after an intended visual change:
 *   npm run test:visual:update -w packages/remit-web-client
 *
 * To run the suite:
 *   npm run test:visual -w packages/remit-web-client
 */
export default defineConfig({
	testDir: "./visual-regression",
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
			// Allow tiny font-rendering differences between machines but flag
			// real layout regressions. Tighten if false positives bite.
			maxDiffPixelRatio: 0.01,
			animations: "disabled",
		},
	},
	projects: [
		{
			name: "phone",
			use: {
				...devices["iPhone 13"],
				// Force a stable viewport (some devices iPhone-13 emulates 390×844
				// scale 3 with hasTouch, which we want).
				viewport: { width: 390, height: 844 },
			},
		},
		{
			name: "tablet",
			use: {
				...devices["iPad Mini"],
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
