import { defineConfig, devices } from "@playwright/test";

// Point test fixtures at the PG backend (the accountId fixture reads BACKEND_URL)
process.env.BACKEND_URL = "http://localhost:5436";

export default defineConfig({
	testDir: "./smoke",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? "github" : "html",
	timeout: 30_000,
	globalSetup: "./smoke/global-setup.pg.ts",
	use: {
		baseURL: "http://localhost:5174",
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
				"node --env-file=../../.e2e.env --import tsx ../../packages/backend/dev-server/server.ts",
			port: 5436,
			reuseExistingServer: !process.env.CI,
			env: {
				DATA_BACKEND: "postgres",
				CORS_ALLOWED_ORIGINS: "*",
				PG_CONNECTION_URL: "postgresql://remit:remit@localhost:5432/remit_test",
				SERVER_PORT: "5436",
				DYNAMODB_PORT: "5435",
				DYNAMODB_TABLE_NAME: "remit-test",
				KMS_KEY_ID: "FAKE_KMS_KEY_ID",
				FAKE_KMS_DATAKEY: "8AD6A6C8-B5E2-488F-B017-96B662DC01AC",
				SQS_QUEUE_URL: "http://localhost:9324/000000000000/remit-e2e-noop",
				STORAGE_LOCAL_PATH: ".remit/e2e-storage",
				LOCAL_CONTENT_STORAGE_BASE: "../../",
				LOCAL_ACCOUNT_CONFIG_ID: "5kkksa64jz6z9jfjuxbu7pckd",
				BETTER_AUTH_SECRET: "e2e-better-auth-secret-at-least-32-chars-long",
				BETTER_AUTH_URL: "http://localhost:5174",
				BETTER_AUTH_JWKS_URL: "http://localhost:5436/api/auth/jwks",
				BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:5174",
				// Vite proxy for PG smoke is on 5174
				CONTENT_DELIVERY_DOMAIN: "http://localhost:5174",
				NODE_ENV: "test",
				AWS_REGION: "not-a-region",
				AWS_ACCESS_KEY_ID: "local",
				AWS_SECRET_ACCESS_KEY: "local",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
		{
			command: "npx vite --port 5174",
			port: 5174,
			reuseExistingServer: !process.env.CI,
			env: {
				// Proxy /api and /content to the PG backend
				VITE_PROXY_BACKEND_PORT: "5436",
				VITE_DISABLE_DEVTOOLS: "1",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	],
});
