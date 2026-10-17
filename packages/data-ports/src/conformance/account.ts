import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
	AccountAuthType,
	AccountService,
	ConnectionState,
	SyncPhase,
} from "@remit/domain-enums";
import type { IAccountRepository } from "../interfaces/account.js";
import type { CreateAccountInput, UpdateAccountInput } from "../types.js";
import type { RepositoryConformanceHarness } from "./harness.js";

const accountInput = (accountConfigId: string): CreateAccountInput => ({
	accountConfigId,
	username: "person@example.com",
	email: "person@example.com",
	imapHost: "imap.example.com",
	imapPort: 993,
	imapTls: true,
	imapStartTls: false,
	isActive: true,
	connectionState: ConnectionState.NotAuthenticated,
});

const everyUpdatableField: Required<UpdateAccountInput> = {
	username: "renamed@example.org",
	email: "renamed@example.org",
	authType: AccountAuthType.OauthMicrosoft,
	syncedServices: [AccountService.Calendar],
	grantedScopes: ["https://outlook.office.com/SMTP.Send"],
	passwordHash: "password-ciphertext",
	oauthRefreshTokenHash: "refresh-token-ciphertext",
	oauthTokenUpdatedAt: 1_700_000_000_001,
	imapHost: "imap.example.org",
	imapPort: 143,
	imapTls: false,
	imapStartTls: true,
	smtpEnabled: true,
	smtpHost: "smtp.example.org",
	smtpPort: 465,
	smtpTls: true,
	smtpStartTls: true,
	smtpUsername: "smtp-person",
	smtpPasswordHash: "smtp-password-ciphertext",
	isActive: false,
	connectionState: ConnectionState.Authenticated,
	deletedAt: 1_700_000_000_002,
	lastConnectedAt: 1_700_000_000_003,
	lastSyncAt: 1_700_000_000_004,
	lastError: "refused",
	syncPhase: SyncPhase.complete,
	mailboxCountTotal: 7,
	mailboxCountSynced: 3,
};

export function accountRepositoryConformance(
	harness: RepositoryConformanceHarness<IAccountRepository>,
): void {
	describe("IAccountRepository conformance", () => {
		let repo: IAccountRepository;

		before(async () => {
			repo = await harness.createRepository();
		});

		after(() => harness.teardown());

		test("an account created without a service selection syncs mail", async () => {
			const created = await repo.create(accountInput(harness.makeId()));

			assert.deepEqual(created.syncedServices, [AccountService.Mail]);
			assert.deepEqual((await repo.get(created.accountId)).syncedServices, [
				AccountService.Mail,
			]);
		});

		test("an account keeps the selection it was created with", async () => {
			const created = await repo.create({
				...accountInput(harness.makeId()),
				syncedServices: [AccountService.Calendar],
			});

			assert.deepEqual((await repo.get(created.accountId)).syncedServices, [
				AccountService.Calendar,
			]);
		});

		test("an update replaces the selection outright", async () => {
			const created = await repo.create(accountInput(harness.makeId()));

			const updated = await repo.update(created.accountId, {
				syncedServices: [AccountService.Mail, AccountService.Calendar],
			});

			assert.deepEqual(updated.syncedServices, [
				AccountService.Mail,
				AccountService.Calendar,
			]);
			assert.deepEqual((await repo.get(created.accountId)).syncedServices, [
				AccountService.Mail,
				AccountService.Calendar,
			]);
		});

		test("an update that leaves the selection out keeps it", async () => {
			const created = await repo.create({
				...accountInput(harness.makeId()),
				syncedServices: [AccountService.Calendar],
			});

			await repo.update(created.accountId, { lastError: "timeout" });

			assert.deepEqual((await repo.get(created.accountId)).syncedServices, [
				AccountService.Calendar,
			]);
		});

		test("the mail sources of a config leave out an account with mail off", async () => {
			const accountConfigId = harness.makeId();
			const mailOnly = await repo.create(accountInput(accountConfigId));
			const both = await repo.create({
				...accountInput(accountConfigId),
				syncedServices: [AccountService.Mail, AccountService.Calendar],
			});
			await repo.create({
				...accountInput(accountConfigId),
				syncedServices: [AccountService.Calendar],
			});
			await repo.create(accountInput(harness.makeId()));

			const sources =
				await repo.listMailSourcesByAccountConfig(accountConfigId);

			assert.deepEqual(
				sources.map((account) => account.accountId).sort(),
				[mailOnly.accountId, both.accountId].sort(),
			);
		});

		test("an update stores every field it is handed", async () => {
			const created = await repo.create(accountInput(harness.makeId()));

			await repo.update(created.accountId, everyUpdatableField);

			const stored = await repo.get(created.accountId);
			assert.deepEqual(stored, {
				...created,
				...everyUpdatableField,
				updatedAt: stored.updatedAt,
			});
		});
	});
}
