import { type APIRequestContext, test as base } from "@playwright/test";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5433";

const MAILFUZZ_CONFIG = {
	host: process.env.MAILFUZZ_HOST ?? "localhost",
	port: Number(process.env.MAILFUZZ_PORT ?? 1143),
	user: process.env.MAILFUZZ_USER ?? "vmail",
	password: process.env.MAILFUZZ_PASSWORD ?? "testpass123",
};

interface AccountFixture {
	accountId: string;
	backendUrl: string;
}

const createTestAccount = async (
	request: APIRequestContext,
): Promise<string> => {
	const response = await request.post(`${BACKEND_URL}/api/accounts`, {
		data: {
			email: MAILFUZZ_CONFIG.user,
			username: MAILFUZZ_CONFIG.user,
			password: MAILFUZZ_CONFIG.password,
			imapHost: MAILFUZZ_CONFIG.host,
			imapPort: MAILFUZZ_CONFIG.port,
			imapTls: false,
		},
	});

	if (!response.ok()) {
		const body = await response.text();
		throw new Error(
			`Failed to create test account: ${response.status()} ${body}`,
		);
	}

	const data = (await response.json()) as { accountId: string };
	return data.accountId;
};

const deleteTestAccount = async (
	request: APIRequestContext,
	accountId: string,
): Promise<void> => {
	await request.delete(`${BACKEND_URL}/api/accounts/${accountId}`);
};

const triggerSync = async (
	request: APIRequestContext,
	accountId: string,
): Promise<void> => {
	const response = await request.post(
		`${BACKEND_URL}/api/accounts/${accountId}/sync`,
	);

	if (!response.ok()) {
		const body = await response.text();
		throw new Error(`Failed to trigger sync: ${response.status()} ${body}`);
	}
};

const waitForSync = async (
	request: APIRequestContext,
	accountId: string,
	timeoutMs = 30_000,
): Promise<void> => {
	const start = Date.now();
	const pollInterval = 2_000;

	while (Date.now() - start < timeoutMs) {
		const response = await request.get(
			`${BACKEND_URL}/api/accounts/${accountId}/mailboxes`,
		);

		if (response.ok()) {
			const data = (await response.json()) as { items: unknown[] };
			if (data.items.length > 0) {
				return;
			}
		}

		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	throw new Error(`Sync did not complete within ${timeoutMs}ms`);
};

export const test = base.extend<AccountFixture>({
	accountId: async ({ request }, use) => {
		const accountId = await createTestAccount(request);
		await triggerSync(request, accountId);
		await waitForSync(request, accountId);
		await use(accountId);
		await deleteTestAccount(request, accountId);
	},
	backendUrl: BACKEND_URL,
});

export { expect } from "@playwright/test";
