import { defineConfig, devices } from "@playwright/test";

// Point test fixtures at the DDB smoke backend
process.env.BACKEND_URL = "http://localhost:5438";

export default defineConfig({
	testDir: "./smoke",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? "github" : "html",
	timeout: 30_000,
	globalSetup: "./smoke/global-setup.ts",
	use: {
		baseURL: "http://localhost:5175",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: [
		{
			command:
				"node --env-file=../../localhost-test-e2e.env --import tsx ../../packages/remit-backend/dev-server/server.ts",
			port: 5438,
			reuseExistingServer: !process.env.CI,
			env: {
				DYNAMODB_PORT: "5437",
				DYNAMODB_TABLE_NAME: "remit-test",
				SERVER_PORT: "5438",
				KMS_KEY_ID: "FAKE_KMS_KEY_ID",
				FAKE_KMS_DATAKEY: "8AD6A6C8-B5E2-488F-B017-96B662DC01AC",
				SQS_QUEUE_URL: "http://localhost:9324/000000000000/remit-e2e-noop",
				STORAGE_LOCAL_PATH: ".remit/e2e-storage",
				LOCAL_CONTENT_STORAGE_BASE: "../../",
				LOCAL_ACCOUNT_CONFIG_ID: "5kkksa64jz6z9jfjuxbu7pckd",
				CONTENT_DELIVERY_DOMAIN: "http://localhost:5175",
				NODE_ENV: "test",
				AWS_REGION: "not-a-region",
				AWS_ACCESS_KEY_ID: "local",
				AWS_SECRET_ACCESS_KEY: "local",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			command: "npx vite --port 5175",
			port: 5175,
			reuseExistingServer: !process.env.CI,
			env: {
				// Proxy /api and /content to the DDB smoke backend
				VITE_PROXY_BACKEND_PORT: "5438",
				VITE_DISABLE_DEVTOOLS: "1",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	],
});
