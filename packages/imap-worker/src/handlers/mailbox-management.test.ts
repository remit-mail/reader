import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import type {
	MailboxCreateEvent,
	MailboxDeleteEvent,
	MailboxRenameEvent,
} from "../events.js";
import {
	type MailboxManagementDeps,
	processMailboxManagement,
} from "./mailbox-management.js";

interface Call {
	method: string;
	args: unknown[];
}

interface Connection {
	createMailbox: (path: string) => Promise<{ created: boolean }>;
	subscribeMailbox: (path: string) => Promise<void>;
	listMailboxes: () => Promise<{ fullPath: string }[]>;
	openBox: (
		path: string,
		readOnly?: boolean,
	) => Promise<{
		uidvalidity: number;
		uidnext: number;
		messages: { total: number };
	}>;
	closeBox: () => Promise<void>;
	renameMailbox: (oldPath: string, newPath: string) => Promise<void>;
	deleteMailbox: (path: string) => Promise<void>;
}

interface Harness {
	calls: Call[];
	account: {
		accountId: string;
		accountConfigId: string;
		deletedAt?: number;
	} | null;
	connection: Connection;
	mailboxUpdateError?: Error;
	disconnectCount: number;
}

let h: Harness;

const notFoundError = (): Error =>
	Object.assign(new Error("Mailbox not found: mbx-1"), {
		name: "NotFoundError",
	});

const record =
	(method: string) =>
	async (...args: unknown[]) => {
		h.calls.push({ method, args });
	};

const buildConnection = (): Connection => ({
	createMailbox: async (path: string) => {
		h.calls.push({ method: "connection.createMailbox", args: [path] });
		return { created: true };
	},
	subscribeMailbox: record("connection.subscribeMailbox"),
	listMailboxes: async () => [{ fullPath: "Archive" }],
	openBox: async () => ({
		uidvalidity: 7,
		uidnext: 42,
		messages: { total: 3 },
	}),
	closeBox: record("connection.closeBox"),
	renameMailbox: record("connection.renameMailbox"),
	deleteMailbox: record("connection.deleteMailbox"),
});

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	connection: buildConnection(),
	disconnectCount: 0,
});

const deps = (): MailboxManagementDeps =>
	({
		getClient: async () => ({
			account: {
				get: async (accountId: string) => {
					h.calls.push({ method: "account.get", args: [accountId] });
					return h.account;
				},
			},
			mailbox: {
				update: async (...args: unknown[]) => {
					h.calls.push({ method: "mailbox.update", args });
					if (h.mailboxUpdateError) throw h.mailboxUpdateError;
				},
				findByPathPrefix: async (...args: unknown[]) => {
					h.calls.push({ method: "mailbox.findByPathPrefix", args });
					return [];
				},
				delete: record("mailbox.delete"),
			},
			secrets: {},
		}),
		buildLifecycleDeps: () => ({}),
		withOAuthLifecycle: async (
			_deps: unknown,
			_account: unknown,
			_log: unknown,
			cb: (credentials: unknown) => Promise<void>,
		) => cb({}),
		createConnectionScope: () => ({
			getConnection: async () => h.connection,
			disconnect: async () => {
				h.disconnectCount += 1;
			},
		}),
	}) as unknown as MailboxManagementDeps;

const createEvent: MailboxCreateEvent = {
	type: "MAILBOX_CREATE",
	accountId: "acc-1",
	mailboxId: "mbx-1",
	path: "Archive",
} as MailboxCreateEvent;

const renameEvent: MailboxRenameEvent = {
	type: "MAILBOX_RENAME",
	accountId: "acc-1",
	mailboxId: "mbx-1",
	oldPath: "Archive",
	newPath: "Archive 2024",
} as MailboxRenameEvent;

const deleteEvent: MailboxDeleteEvent = {
	type: "MAILBOX_DELETE",
	accountId: "acc-1",
	mailboxId: "mbx-1",
	path: "Archive",
} as MailboxDeleteEvent;

const called = (method: string): Call[] =>
	h.calls.filter((c) => c.method === method);

const lastUpdate = (): Record<string, unknown> =>
	(called("mailbox.update").at(-1)?.args[2] ?? {}) as Record<string, unknown>;

describe("processMailboxManagement — MAILBOX_CREATE", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("creates the folder and writes back the server's UIDVALIDITY and counts", async () => {
		await processMailboxManagement(createEvent, noopLogger, deps());

		assert.equal(called("connection.createMailbox")[0]?.args[0], "Archive");
		assert.deepEqual(lastUpdate(), {
			uidValidity: 7,
			uidNext: 42,
			messageCount: 3,
			syncStatus: "synced",
		});
		assert.equal(h.disconnectCount, 1, "the scope is always disconnected");
	});

	it("subscribes only when the event asks for it", async () => {
		await processMailboxManagement(createEvent, noopLogger, deps());
		assert.equal(called("connection.subscribeMailbox").length, 0);

		h = fresh();
		await processMailboxManagement(
			{ ...createEvent, subscribe: true },
			noopLogger,
			deps(),
		);
		assert.equal(called("connection.subscribeMailbox")[0]?.args[0], "Archive");
	});

	it("still marks the mailbox synced when the server does not list the new folder", async () => {
		h.connection.listMailboxes = async () => [];

		await processMailboxManagement(createEvent, noopLogger, deps());

		assert.deepEqual(lastUpdate(), { syncStatus: "synced" });
	});

	it("treats an already-existing folder as success rather than a failure", async () => {
		h.connection.createMailbox = async () => {
			throw new Error("Mailbox already exists");
		};

		await processMailboxManagement(createEvent, noopLogger, deps());

		assert.deepEqual(lastUpdate(), { syncStatus: "synced" });
	});

	it("marks the mailbox failed and rethrows on any other create error", async () => {
		h.connection.createMailbox = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			processMailboxManagement(createEvent, noopLogger, deps()),
			/server exploded/,
		);

		assert.deepEqual(lastUpdate(), { syncStatus: "failed" });
		assert.equal(h.disconnectCount, 1);
	});

	it("acks terminally without rethrowing when the mailbox row was deleted mid-create (#289)", async () => {
		// The status write-back throws NotFoundError because the row is gone; the
		// create is moot and must not poison the account's FIFO.
		h.mailboxUpdateError = notFoundError();

		await processMailboxManagement(createEvent, noopLogger, deps());

		assert.equal(h.disconnectCount, 1, "the scope is still disconnected");
	});

	it("returns early without connecting when the account is soft-deleted", async () => {
		h.account = {
			accountId: "acc-1",
			accountConfigId: "cfg-1",
			deletedAt: Date.now(),
		};

		await processMailboxManagement(createEvent, noopLogger, deps());

		assert.equal(called("connection.createMailbox").length, 0);
	});

	it("throws when the account no longer exists", async () => {
		h.account = null;

		await assert.rejects(
			processMailboxManagement(createEvent, noopLogger, deps()),
			/not found/,
		);
	});
});

describe("processMailboxManagement — MAILBOX_RENAME", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("renames on the server and clears the pending oldPath", async () => {
		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.deepEqual(called("connection.renameMailbox")[0]?.args, [
			"Archive",
			"Archive 2024",
		]);
		assert.deepEqual(lastUpdate(), {
			oldPath: undefined,
			syncStatus: "synced",
		});
	});

	it("drops the local row when the source folder is gone on the server", async () => {
		h.connection.renameMailbox = async () => {
			throw new Error("Mailbox not found");
		};

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.deepEqual(called("mailbox.delete")[0]?.args, ["acc-1", "mbx-1"]);
		assert.equal(called("mailbox.update").length, 0);
	});

	it("acks terminally without rethrowing when the rollback write finds the row gone", async () => {
		h.connection.renameMailbox = async () => {
			throw new Error("server exploded");
		};
		h.mailboxUpdateError = notFoundError();

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.equal(h.disconnectCount, 1, "the scope is still disconnected");
	});

	it("rolls the local path back and rethrows on any other rename error", async () => {
		h.connection.renameMailbox = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			processMailboxManagement(renameEvent, noopLogger, deps()),
			/server exploded/,
		);

		assert.deepEqual(lastUpdate(), {
			fullPath: "Archive",
			oldPath: undefined,
			syncStatus: "failed",
		});
	});
});

describe("processMailboxManagement — MAILBOX_DELETE", () => {
	beforeEach(() => {
		h = fresh();
	});

	it("deletes on the server and drops the local row", async () => {
		await processMailboxManagement(deleteEvent, noopLogger, deps());

		assert.equal(called("connection.deleteMailbox")[0]?.args[0], "Archive");
		assert.deepEqual(called("mailbox.delete")[0]?.args, ["acc-1", "mbx-1"]);
	});

	it("drops the local row when the folder is already gone on the server", async () => {
		h.connection.deleteMailbox = async () => {
			throw new Error("Mailbox not found");
		};

		await processMailboxManagement(deleteEvent, noopLogger, deps());

		assert.equal(called("mailbox.delete").length, 1);
	});

	it("restores the mailbox and swallows the error when the server refuses to delete INBOX", async () => {
		h.connection.deleteMailbox = async () => {
			throw new Error("Cannot delete INBOX");
		};

		await processMailboxManagement(deleteEvent, noopLogger, deps());

		assert.deepEqual(lastUpdate(), { syncStatus: "synced" });
		assert.equal(called("mailbox.delete").length, 0);
	});

	it("marks the mailbox failed and rethrows on any other delete error", async () => {
		h.connection.deleteMailbox = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			processMailboxManagement(deleteEvent, noopLogger, deps()),
			/server exploded/,
		);

		assert.deepEqual(lastUpdate(), { syncStatus: "failed" });
	});

	it("acks terminally without rethrowing when the rollback write finds the row gone", async () => {
		h.connection.deleteMailbox = async () => {
			throw new Error("server exploded");
		};
		h.mailboxUpdateError = notFoundError();

		await processMailboxManagement(deleteEvent, noopLogger, deps());

		assert.equal(h.disconnectCount, 1, "the scope is still disconnected");
	});
});

describe("processMailboxManagement — a tagged NO the server means as success (#339)", () => {
	beforeEach(() => {
		h = fresh();
	});

	/**
	 * Dovecot answers `NO [NONEXISTENT] Mailbox doesn't exist`, which ImapFlow
	 * raises as a bare "Command failed" carrying the code on the error. Reading
	 * only the message treated an already-absent folder as a failure: the row was
	 * marked failed and the event left poisoning the account's queue.
	 */
	it("treats it as the delete already having happened, and drops the local row", async () => {
		h.connection.deleteMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "NONEXISTENT",
				responseText: "Mailbox doesn't exist: Archive",
			});
		};

		await assert.doesNotReject(
			processMailboxManagement(deleteEvent, noopLogger, deps()),
		);
		assert.deepEqual(called("mailbox.delete")[0]?.args, ["acc-1", "mbx-1"]);
		assert.equal(called("mailbox.update").length, 0);
	});

	it("still marks failed and rethrows when the server fails for any other reason", async () => {
		h.connection.deleteMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "SERVERBUG",
				responseText: "Internal error",
			});
		};

		await assert.rejects(
			processMailboxManagement(deleteEvent, noopLogger, deps()),
			/Command failed/,
		);
		assert.deepEqual(lastUpdate(), { syncStatus: "failed" });
	});

	/**
	 * Dovecot answers `NO [ALREADYEXISTS]` when the folder is already there — a
	 * folder another client made, or a redelivered create. That is the create
	 * having happened. Reading it as a failure marked the row `failed` and
	 * rethrew, holding back every later sync on the account's FIFO group.
	 */
	it("reads ALREADYEXISTS on a CREATE as the folder already being there", async () => {
		h.connection.createMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "ALREADYEXISTS",
				responseText: "Mailbox already exists: Archive",
			});
		};

		await assert.doesNotReject(
			processMailboxManagement(createEvent, noopLogger, deps()),
		);
		assert.deepEqual(lastUpdate(), { syncStatus: "synced" });
	});

	it("still marks failed and rethrows when a CREATE fails for any other reason", async () => {
		h.connection.createMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "SERVERBUG",
				responseText: "Internal error",
			});
		};

		await assert.rejects(
			processMailboxManagement(createEvent, noopLogger, deps()),
			/Command failed/,
		);
		assert.deepEqual(lastUpdate(), { syncStatus: "failed" });
	});

	it("reads NONEXISTENT on a RENAME as the source folder being gone", async () => {
		h.connection.renameMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "NONEXISTENT",
				responseText: "Mailbox doesn't exist: Archive",
			});
		};

		await assert.doesNotReject(
			processMailboxManagement(renameEvent, noopLogger, deps()),
		);
		assert.deepEqual(called("mailbox.delete")[0]?.args, ["acc-1", "mbx-1"]);
	});

	it("still rolls back and rethrows when a RENAME fails for any other reason", async () => {
		h.connection.renameMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "SERVERBUG",
				responseText: "Internal error",
			});
		};

		await assert.rejects(
			processMailboxManagement(renameEvent, noopLogger, deps()),
			/Command failed/,
		);
		assert.equal(lastUpdate()?.syncStatus, "failed");
	});
});
