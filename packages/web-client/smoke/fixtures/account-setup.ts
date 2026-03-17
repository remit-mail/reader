import { test as base } from "@playwright/test";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:5433";

interface AccountFixture {
	accountId: string;
	backendUrl: string;
}

export const test = base.extend<AccountFixture>({
	accountId: "0jgzhrmpc55wveirawi66hoqp",
	backendUrl: BACKEND_URL,
});

export { expect } from "@playwright/test";
