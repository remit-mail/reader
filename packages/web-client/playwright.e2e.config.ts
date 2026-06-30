import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? "github" : "html",
	timeout: 60_000,
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
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
				SQS_QUEUE_URL: "http://localhost:9325/000000000000/remit-e2e",
				SQS_QUEUE_URL_MAILBOXES:
					"http://localhost:9325/000000000000/remit-e2e-mailboxes.fifo",
				SQS_QUEUE_URL_MESSAGES:
					"http://localhost:9325/000000000000/remit-e2e-messages.fifo",
				SQS_QUEUE_URL_BODY: "http://localhost:9325/000000000000/remit-e2e-body",
				SQS_QUEUE_URL_FLAGS:
					"http://localhost:9325/000000000000/remit-e2e-flags.fifo",
				SQS_QUEUE_URL_MAILBOX_MGMT:
					"http://localhost:9325/000000000000/remit-e2e-mailbox-mgmt",
				SQS_QUEUE_URL_MESSAGE_MGMT:
					"http://localhost:9325/000000000000/remit-e2e-message-mgmt",
				STORAGE_LOCAL_PATH: ".remit/e2e-storage",
				LOCAL_CONTENT_STORAGE_BASE: "../../",
				LOCAL_ACCOUNT_CONFIG_ID: "5be2vjpnoscpy591tt9iopmuz",
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
