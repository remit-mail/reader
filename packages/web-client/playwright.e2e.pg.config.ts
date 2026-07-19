import { defineConfig, devices } from "@playwright/test";

const PG_CONNECTION_URL =
	process.env.PG_CONNECTION_URL ??
	"postgresql://remit:remit@localhost:5432/remit_test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? "github" : "html",
	timeout: 60_000,
	globalSetup: "./e2e/global-setup.pg.ts",
	globalTeardown: "./e2e/global-teardown.ts",
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
				"node --env-file=../../localhost-test-e2e.env --import tsx ../../packages/backend/dev-server/server.ts",
			port: 5439,
			reuseExistingServer: !process.env.CI,
			env: {
				DATA_BACKEND: "postgres",
				CORS_ALLOWED_ORIGINS: "*",
				PG_CONNECTION_URL,
				DYNAMODB_PORT: "5437",
				DYNAMODB_TABLE_NAME: "remit-test",
				SERVER_PORT: "5439",
				KMS_KEY_ID: "FAKE_KMS_KEY_ID",
				FAKE_KMS_DATAKEY: "8AD6A6C8-B5E2-488F-B017-96B662DC01AC",
				SQS_QUEUE_URL: "http://localhost:9324/000000000000/remit-e2e",
				SQS_QUEUE_URL_MAILBOXES:
					"http://localhost:9324/000000000000/remit-e2e-mailboxes.fifo",
				SQS_QUEUE_URL_MESSAGES:
					"http://localhost:9324/000000000000/remit-e2e-messages.fifo",
				SQS_QUEUE_URL_BODY: "http://localhost:9324/000000000000/remit-e2e-body",
				SQS_QUEUE_URL_FLAGS:
					"http://localhost:9324/000000000000/remit-e2e-flags.fifo",
				SQS_QUEUE_URL_MAILBOX_MGMT:
					"http://localhost:9324/000000000000/remit-e2e-mailbox-mgmt",
				SQS_QUEUE_URL_MESSAGE_MGMT:
					"http://localhost:9324/000000000000/remit-e2e-message-mgmt",
				STORAGE_LOCAL_PATH: ".remit/e2e-storage",
				LOCAL_CONTENT_STORAGE_BASE: "../../",
				LOCAL_ACCOUNT_CONFIG_ID: "05iquyhykvfin7kzuxpe9dyq2",
				BETTER_AUTH_SECRET: "e2e-better-auth-secret-at-least-32-chars-long",
				BETTER_AUTH_URL: "http://localhost:5175",
				BETTER_AUTH_JWKS_URL: "http://localhost:5439/api/auth/jwks",
				BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:5175",
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
				VITE_PROXY_BACKEND_PORT: "5439",
				REMIT_RUNTIME_CONFIG: '{"betterAuthEnabled":false}',
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	],
});
