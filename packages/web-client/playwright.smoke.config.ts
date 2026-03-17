import { defineConfig, devices } from "@playwright/test";

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
		baseURL: "http://localhost:5173",
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
