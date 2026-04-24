import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type AccountConfigItem,
	type AccountConfigService,
	ConflictError,
	NotFoundError,
} from "@remit/remit-electrodb-service";
import { ensureAccountConfig } from "./ensure-account-config.js";

type GetCall = { id: string };
type CreateCall = { accountConfigId: string; userId: string };

interface FakeServiceOptions {
	existing?: Partial<AccountConfigItem>;
	getError?: unknown;
	createError?: unknown;
}

const makeFakeAccountConfigService = (opts: FakeServiceOptions = {}) => {
	const getCalls: GetCall[] = [];
	const createCalls: CreateCall[] = [];

	const service = {
		get: async (id: string) => {
			getCalls.push({ id });
			if (opts.getError) throw opts.getError;
			if (opts.existing) return opts.existing as AccountConfigItem;
			throw new NotFoundError(`AccountConfig not found: ${id}`);
		},
		create: async (input: { accountConfigId: string; userId: string }) => {
			createCalls.push({
				accountConfigId: input.accountConfigId,
				userId: input.userId,
			});
			if (opts.createError) throw opts.createError;
			return {
				accountConfigId: input.accountConfigId,
				userId: input.userId,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			} as AccountConfigItem;
		},
	};

	return {
		service: service as unknown as AccountConfigService,
		getCalls,
		createCalls,
	};
};

const ACCOUNT_CONFIG_ID = "abcdefghijklmnopqrstuvwxy";

describe("ensureAccountConfig", () => {
	it("creates an AccountConfig when none exists", async () => {
		const { service, getCalls, createCalls } = makeFakeAccountConfigService();

		await ensureAccountConfig(service, ACCOUNT_CONFIG_ID);

		assert.deepEqual(getCalls, [{ id: ACCOUNT_CONFIG_ID }]);
		assert.deepEqual(createCalls, [
			{ accountConfigId: ACCOUNT_CONFIG_ID, userId: ACCOUNT_CONFIG_ID },
		]);
	});

	it("is a no-op when the AccountConfig already exists", async () => {
		const { service, getCalls, createCalls } = makeFakeAccountConfigService({
			existing: {
				accountConfigId: ACCOUNT_CONFIG_ID,
				userId: ACCOUNT_CONFIG_ID,
			},
		});

		await ensureAccountConfig(service, ACCOUNT_CONFIG_ID);

		assert.deepEqual(getCalls, [{ id: ACCOUNT_CONFIG_ID }]);
		assert.equal(createCalls.length, 0);
	});

	it("swallows ConflictError on create (race between two first calls)", async () => {
		const { service, getCalls, createCalls } = makeFakeAccountConfigService({
			createError: new ConflictError("already exists"),
		});

		await ensureAccountConfig(service, ACCOUNT_CONFIG_ID);

		assert.equal(getCalls.length, 1);
		assert.equal(createCalls.length, 1);
	});

	it("propagates non-NotFound get errors", async () => {
		const { service } = makeFakeAccountConfigService({
			getError: new Error("network down"),
		});

		await assert.rejects(
			() => ensureAccountConfig(service, ACCOUNT_CONFIG_ID),
			/network down/,
		);
	});

	it("propagates non-Conflict create errors", async () => {
		const { service } = makeFakeAccountConfigService({
			createError: new Error("DynamoDB throttled"),
		});

		await assert.rejects(
			() => ensureAccountConfig(service, ACCOUNT_CONFIG_ID),
			/DynamoDB throttled/,
		);
	});
});
