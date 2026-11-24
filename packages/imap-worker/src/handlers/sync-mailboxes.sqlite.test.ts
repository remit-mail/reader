import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AccountAuthType,
	ConnectionState,
	SyncPhase,
} from "@remit/domain-enums";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import { encryptRefreshToken } from "@remit/mailbox-service/account-credentials";
import { MailConnectionError } from "@remit/mailbox-service/types";
import type { SyncMailboxesEvent } from "../events.js";
import { openStore } from "../test-helpers/test-world.js";
import { syncMailboxes } from "./sync-mailboxes.js";

const discoveryEvent = (accountId: string): SyncMailboxesEvent => ({
	type: "SYNC_MAILBOXES",
	eventId: "mailbox-discovery",
	timestamp: 1_700_000_000_000,
	accountId,
	explicitRequest: true,
});

describe("mailbox discovery round identity", () => {
	it("stamps complete when mail sync is off", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		await world.client.account.update(accountId, {
			syncedServices: [],
			syncRequestedAt: event.timestamp - 1,
			syncPhase: SyncPhase.discovering_mailboxes,
		});

		await syncMailboxes(event, world.ctx());

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.syncPhase, SyncPhase.complete);
		assert.equal(world.imap.connections, 0);
	});

	it("stamps complete when the host cannot sync", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		await world.client.account.update(accountId, {
			imapHost: "imap.invalid",
			syncRequestedAt: event.timestamp - 1,
			syncPhase: SyncPhase.discovering_mailboxes,
		});

		await syncMailboxes(event, world.ctx());

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.syncPhase, SyncPhase.complete);
		assert.equal(world.imap.connections, 0);
	});

	it("stamps error when the account already requires reauth", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		await world.client.account.update(accountId, {
			connectionState: ConnectionState.ReauthRequired,
			syncRequestedAt: event.timestamp - 1,
			syncPhase: SyncPhase.discovering_mailboxes,
		});

		await syncMailboxes(event, world.ctx());

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.syncPhase, SyncPhase.error);
		assert.equal(world.imap.connections, 0);
	});

	it("stamps error when the account has no credential", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		await world.client.account.update(accountId, {
			authType: AccountAuthType.OauthMicrosoft,
			lastError: "An earlier sync failed",
		});

		await syncMailboxes(event, world.ctx());

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.syncPhase, SyncPhase.error);
		assert.equal(stored.connectionState, ConnectionState.ReauthRequired);
		assert.equal(stored.lastError, undefined);
		assert.equal(world.imap.connections, 0);
	});

	it("stamps error when OAuth refresh requires reauth", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		await world.client.account.update(accountId, {
			authType: AccountAuthType.OauthMicrosoft,
			oauthRefreshTokenHash: await encryptRefreshToken(
				"refresh-token",
				world.client.secrets,
			),
			lastError: "An earlier sync failed",
		});

		await syncMailboxes(
			event,
			world.ctx({
				oauth: {
					getAccessToken: async () => {
						throw new RefreshTokenError({
							kind: "reauth-required",
							code: "invalid_grant",
						});
					},
				},
			}),
		);

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.syncPhase, SyncPhase.error);
		assert.equal(stored.connectionState, ConnectionState.ReauthRequired);
		assert.equal(stored.lastError, undefined);
		assert.equal(world.imap.connections, 0);
	});

	it("stamps error when IMAP rejects OAuth authentication", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		await world.client.account.update(accountId, {
			authType: AccountAuthType.OauthMicrosoft,
			oauthRefreshTokenHash: await encryptRefreshToken(
				"refresh-token",
				world.client.secrets,
			),
			lastError: "An earlier sync failed",
		});
		const pool = world.connectVia(() => ({
			getConnection: async () => {
				throw new MailConnectionError("auth", "IMAP authentication rejected");
			},
			disconnect: async () => {},
		}));

		await syncMailboxes(
			event,
			world.ctx({
				pool,
				oauth: {
					getAccessToken: async () => ({
						accessToken: "access-token",
						expiresAt: 0,
						grantedScopes: [],
					}),
				},
			}),
		);

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.syncPhase, SyncPhase.error);
		assert.equal(stored.connectionState, ConnectionState.ReauthRequired);
		assert.equal(stored.lastError, "IMAP authentication rejected");
	});

	it("stamps and rethrows a password authentication failure", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		const error = new MailConnectionError("auth", "Password rejected");
		const pool = world.connectVia(() => ({
			getConnection: async () => {
				throw error;
			},
			disconnect: async () => {},
		}));

		await assert.rejects(syncMailboxes(event, world.ctx({ pool })), error);

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.syncPhase, SyncPhase.error);
		assert.equal(stored.lastError, "Password rejected");
		assert.equal(stored.connectionState, world.account.connectionState);
	});

	it("records the event timestamp with the discovering phase", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		world.imap.addFolder("INBOX");
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		const update = t.mock.method(world.client.account, "update");

		await syncMailboxes(event, world.ctx());

		assert.deepEqual(
			update.mock.calls.find(
				(call) =>
					call.arguments[1].syncPhase === SyncPhase.discovering_mailboxes,
			)?.arguments,
			[
				accountId,
				{
					syncPhase: SyncPhase.discovering_mailboxes,
					syncRequestedAt: event.timestamp,
				},
			],
		);
		assert.equal(
			(await world.client.account.get(accountId)).syncRequestedAt,
			event.timestamp,
		);
	});

	it("records the event timestamp when discovery fails before the discovering phase", async (t) => {
		const store = await openStore();
		t.after(store.close);
		const world = await store.world();
		const { accountId } = world.account;
		const event = discoveryEvent(accountId);
		const error = new Error("Connection unavailable");
		const pool = world.connectVia(() => ({
			getConnection: async () => {
				throw error;
			},
			disconnect: async () => {},
		}));

		await assert.rejects(syncMailboxes(event, world.ctx({ pool })), error);

		const stored = await world.client.account.get(accountId);
		assert.equal(stored.syncPhase, SyncPhase.error);
		assert.equal(stored.syncRequestedAt, event.timestamp);
		assert.equal(stored.lastError, "Connection unavailable");
	});
});
