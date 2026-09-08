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
	renameMailbox: (
		oldPath: string,
		newPath: string,
	) => Promise<{ path: string; newPath: string }>;
	deleteMailbox: (path: string) => Promise<void>;
}

/** The folder rows the handler reads its guards and its settle row-set from. */
interface Row {
	mailboxId: string;
	accountId: string;
	fullPath: string;
	hierarchyDelimiter: string;
	syncStatus: string;
	pendingPath?: string;
}

interface Harness {
	calls: Call[];
	account: {
		accountId: string;
		accountConfigId: string;
		deletedAt?: number;
	} | null;
	connection: Connection;
	rows: Map<string, Row>;
	mailboxUpdateError?: Error;
	mailboxRowGone?: boolean;
	disconnectCount: number;
}

let h: Harness;

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
	renameMailbox: async (oldPath: string, newPath: string) => {
		h.calls.push({
			method: "connection.renameMailbox",
			args: [oldPath, newPath],
		});
		return { path: oldPath, newPath };
	},
	deleteMailbox: record("connection.deleteMailbox"),
});

const row = (over: Partial<Row> & { mailboxId: string }): Row => ({
	accountId: "acc-1",
	fullPath: "Archive",
	hierarchyDelimiter: "/",
	namespacePrefix: "",
	syncStatus: "pending",
	...over,
});

/** The server holding neither path is what confirms the folder is gone. */
const listsNeitherPath = (): void => {
	h.connection.listMailboxes = async () => [{ fullPath: "Iets anders" }];
};

const fresh = (): Harness => ({
	calls: [],
	account: { accountId: "acc-1", accountConfigId: "cfg-1" },
	connection: buildConnection(),
	// A create in flight: `pending` with no recorded rename target, which is
	// what tells it apart from a rename in flight (D3).
	rows: new Map([["mbx-1", row({ mailboxId: "mbx-1" })]]),
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
			accountSetting: {
				get: async () => undefined,
				upsert: record("accountSetting.upsert"),
				delete: record("accountSetting.delete"),
			},
			mailbox: {
				get: async (accountId: string, mailboxId: string) => {
					h.calls.push({ method: "mailbox.get", args: [accountId, mailboxId] });
					const found = h.mailboxRowGone
						? undefined
						: h.rows.get(mailboxId as string);
					if (!found) {
						throw Object.assign(new Error(`Mailbox not found: ${mailboxId}`), {
							name: "NotFoundError",
						});
					}
					return found;
				},
				update: async (...args: unknown[]) => {
					h.calls.push({ method: "mailbox.update", args });
					if (h.mailboxUpdateError) throw h.mailboxUpdateError;
				},
				// The conditional write the folder state now goes through, with the
				// predicate honoured: a row that is gone or that somebody else moved
				// matches nothing, so the loser gets a null rather than a throw and
				// the handler raises the NotFoundError itself.
				transition: async (...args: unknown[]) => {
					h.calls.push({ method: "mailbox.transition", args });
					if (h.mailboxRowGone) return null;
					const mailboxId = args[1] as string;
					const intent = args[2] as {
						from: readonly string[];
						wherePendingPath?: string | null;
						to: string;
						set?: { fullPath?: string };
					};
					const current = h.rows.get(mailboxId);
					if (!current) return null;
					if (!intent.from.includes(current.syncStatus)) return null;
					if (
						intent.wherePendingPath !== undefined &&
						(intent.wherePendingPath ?? undefined) !== current.pendingPath
					) {
						return null;
					}
					const next: Row = {
						...current,
						...(intent.set?.fullPath !== undefined
							? { fullPath: intent.set.fullPath }
							: {}),
						syncStatus: intent.to,
					};
					if (intent.to !== "pending" && intent.to !== "failed") {
						next.pendingPath = undefined;
					}
					h.rows.set(mailboxId, next);
					return next;
				},
				findByPathPrefix: async (...args: unknown[]) => {
					h.calls.push({ method: "mailbox.findByPathPrefix", args });
					return [];
				},
				findBySyncStatus: async (accountId: string, syncStatus: string) => {
					h.calls.push({
						method: "mailbox.findBySyncStatus",
						args: [accountId, syncStatus],
					});
					if (h.mailboxRowGone) return [];
					return [...h.rows.values()].filter(
						(r) => r.syncStatus === syncStatus,
					);
				},
				delete: record("mailbox.delete"),
				deleteMailboxWithMail: record("mailbox.deleteMailboxWithMail"),
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

const lastSettle = (): {
	to?: string;
	set?: Record<string, unknown>;
	wherePendingPath?: string | null;
} =>
	(called("mailbox.transition").at(-1)?.args[2] ?? {}) as {
		to?: string;
		set?: Record<string, unknown>;
		wherePendingPath?: string | null;
	};

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
		});
		assert.equal(lastSettle().to, "synced");
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

		assert.equal(called("mailbox.update").length, 0);
		assert.equal(lastSettle().to, "synced");
	});

	it("treats an already-existing folder as success rather than a failure", async () => {
		h.connection.createMailbox = async () => {
			throw new Error("Mailbox already exists");
		};

		await processMailboxManagement(createEvent, noopLogger, deps());

		assert.equal(lastSettle().to, "synced");
	});

	it("marks the mailbox failed and rethrows on any other create error", async () => {
		h.connection.createMailbox = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			processMailboxManagement(createEvent, noopLogger, deps()),
			/server exploded/,
		);

		assert.equal(lastSettle().to, "failed");
		assert.equal(h.disconnectCount, 1);
	});

	it("acks terminally without rethrowing when the mailbox row was deleted mid-create (#289)", async () => {
		// The settle matches no row because the row is gone; the create is moot
		// and must not poison the account's FIFO.
		h.mailboxRowGone = true;

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

/**
 * The rename intent a MAILBOX_RENAME is settled against: the folder keeps the
 * path the server holds, and carries the target the intent recorded (D2).
 */
const recordRenameIntent = (pendingPath = "Archive 2024"): void => {
	h.rows.set(
		"mbx-1",
		row({ mailboxId: "mbx-1", fullPath: "Archive", pendingPath }),
	);
};

describe("processMailboxManagement — MAILBOX_RENAME", () => {
	beforeEach(() => {
		h = fresh();
		recordRenameIntent();
	});

	it("renames on the server and settles the row onto the confirmed path", async () => {
		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.deepEqual(called("connection.renameMailbox")[0]?.args, [
			"Archive",
			"Archive 2024",
		]);
		assert.equal(lastSettle().to, "synced");
		assert.equal(lastSettle().set?.fullPath, "Archive 2024");
	});

	it("settles onto the path ImapFlow resolved, not the one that was asked for", async () => {
		h.connection.renameMailbox = async (oldPath: string) => {
			h.calls.push({ method: "connection.renameMailbox", args: [oldPath] });
			return { path: oldPath, newPath: "INBOX/Archive 2024" };
		};

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.equal(lastSettle().set?.fullPath, "INBOX/Archive 2024");
	});

	it("takes the folder's mail with it when the source is gone on the server", async () => {
		// The folder was deleted under us. Dropping the row on its own is the
		// orphaning bug: its mail stays keyed to a dead mailboxId, out of every
		// reader and still in the search index (D8).
		listsNeitherPath();
		h.connection.renameMailbox = async () => {
			throw new Error("Mailbox not found");
		};

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.deepEqual(called("mailbox.deleteMailboxWithMail")[0]?.args, [
			"acc-1",
			"mbx-1",
		]);
		assert.equal(called("mailbox.delete").length, 0);
	});

	it("takes every descendant's mail with it too, not just the renamed folder's", async () => {
		// The whole subtree recorded this rename's intent (D6); dropping the
		// root alone strands each descendant `pending` at a path the server
		// never held, with nothing left to revisit it.
		h.rows.set(
			"mbx-2",
			row({
				mailboxId: "mbx-2",
				fullPath: "Archive/Sub",
				pendingPath: "Archive 2024/Sub",
			}),
		);
		listsNeitherPath();
		h.connection.renameMailbox = async () => {
			throw new Error("Mailbox not found");
		};

		await processMailboxManagement(renameEvent, noopLogger, deps());

		const deleted = called("mailbox.deleteMailboxWithMail").map(
			(c) => c.args[1],
		);
		assert.deepEqual(new Set(deleted), new Set(["mbx-1", "mbx-2"]));
	});

	it("refuses the rename rather than deleting when the source is still on the server", async () => {
		// The server said NONEXISTENT and its own listing still holds the folder,
		// so it was talking about something else. Reading that as an upstream
		// delete would destroy the folder's mail over an answer nothing confirms.
		h.connection.renameMailbox = async () => {
			throw new Error("Mailbox not found");
		};

		await assert.rejects(
			processMailboxManagement(renameEvent, noopLogger, deps()),
			/Mailbox not found/,
		);

		assert.equal(called("mailbox.deleteMailboxWithMail").length, 0);
		assert.equal(lastSettle().to, "failed");
	});

	it("acks terminally without connecting when the folder row is gone", async () => {
		h.mailboxRowGone = true;

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.equal(called("connection.renameMailbox").length, 0);
		assert.equal(h.disconnectCount, 1, "the scope is still disconnected");
	});

	it("keeps the confirmed path and the target on a refused rename", async () => {
		// T6. `fullPath` was never written, so there is nothing to restore; the
		// target is kept so the client can name what the rename was aiming at.
		h.connection.renameMailbox = async () => {
			throw new Error("server exploded");
		};

		await assert.rejects(
			processMailboxManagement(renameEvent, noopLogger, deps()),
			/server exploded/,
		);

		assert.equal(lastSettle().to, "failed");
		assert.equal(
			lastSettle().set?.fullPath,
			undefined,
			"nothing is restored: the row never left the path the server holds",
		);
		assert.equal(lastSettle().wherePendingPath, "Archive 2024");
	});

	it("settles instead of deleting when NONEXISTENT means the rename already landed", async () => {
		// A redelivery after a lost settle re-issues RENAME from a path that has
		// moved. Reading that as an upstream delete drops the folder and its mail
		// while the folder is alive at the target.
		h.connection.renameMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "NONEXISTENT",
				responseText: "Mailbox doesn't exist: Archive",
			});
		};
		h.connection.listMailboxes = async () => [{ fullPath: "Archive 2024" }];

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.equal(called("mailbox.deleteMailboxWithMail").length, 0);
		assert.equal(lastSettle().to, "synced");
		assert.equal(lastSettle().set?.fullPath, "Archive 2024");
	});

	it("rethrows a settle failure without marking the rename refused", async () => {
		// The server executed the rename. Marking the rows failed would offer a
		// retry of work already done, on a path the server no longer holds.
		let settles = 0;
		const broken = deps();
		const inner = broken.getClient as unknown as () => Promise<
			Record<string, unknown>
		>;
		broken.getClient = (async () => {
			const client = await inner();
			return {
				...client,
				mailbox: {
					...(client.mailbox as Record<string, unknown>),
					transition: async () => {
						settles += 1;
						throw new Error("database is locked");
					},
				},
			};
		}) as unknown as MailboxManagementDeps["getClient"];

		await assert.rejects(
			processMailboxManagement(renameEvent, noopLogger, broken),
			/local settle did not finish/,
		);
		assert.equal(settles, 1, "the refusal path never ran a second write");
	});

	it("issues no RENAME when the row has already settled", async () => {
		h.rows.set(
			"mbx-1",
			row({
				mailboxId: "mbx-1",
				fullPath: "Archive 2024",
				syncStatus: "synced",
			}),
		);

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.equal(called("connection.renameMailbox").length, 0);
		assert.equal(called("mailbox.transition").length, 0);
	});

	it("issues no RENAME when the row is pending for a different target", async () => {
		h.rows.set("mbx-1", row({ mailboxId: "mbx-1", pendingPath: "Archief" }));

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.equal(called("connection.renameMailbox").length, 0);
		assert.equal(called("mailbox.transition").length, 0);
	});
});

describe("processMailboxManagement — the seventh state (#363, D3)", () => {
	beforeEach(() => {
		h = fresh();
		recordRenameIntent();
	});

	/**
	 * A settled create whose acknowledgement was lost, redelivered against a row
	 * this rename has since claimed. A `pending`-only guard passes it; CREATE
	 * collides and ImapFlow reports `{created: false}`, which #346 correctly
	 * reads as success; the settle then writes `synced` with the rename target
	 * still on the row — and the rename's own settle no longer matches, so the
	 * RENAME never runs and nothing is ever marked failed.
	 */
	it("lets a redelivered create settle nothing on a row a rename has claimed", async () => {
		await processMailboxManagement(createEvent, noopLogger, deps());

		const settle = called("mailbox.transition").at(-1)?.args[2] as {
			wherePendingPath?: string | null;
			to?: string;
		};
		assert.equal(
			settle?.wherePendingPath,
			null,
			"the create settle requires the row to carry no rename target",
		);
		assert.equal(h.rows.get("mbx-1")?.pendingPath, "Archive 2024");
	});

	it("then settles the rename normally", async () => {
		await processMailboxManagement(createEvent, noopLogger, deps());
		h.calls = [];

		await processMailboxManagement(renameEvent, noopLogger, deps());

		assert.equal(called("connection.renameMailbox").length, 1);
		assert.equal(lastSettle().to, "synced");
		assert.equal(lastSettle().set?.fullPath, "Archive 2024");
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

		assert.equal(lastSettle().to, "synced");
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

		assert.equal(lastSettle().to, "failed");
	});

	it("acks terminally without rethrowing when the rollback write finds the row gone", async () => {
		h.connection.deleteMailbox = async () => {
			throw new Error("server exploded");
		};
		h.mailboxRowGone = true;

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
		assert.equal(called("mailbox.transition").length, 0);
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
		assert.equal(lastSettle().to, "failed");
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
		assert.equal(lastSettle().to, "synced");
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
		assert.equal(lastSettle().to, "failed");
	});

	it("reads NONEXISTENT on a RENAME as the source folder being gone, mail and all", async () => {
		recordRenameIntent();
		listsNeitherPath();
		h.connection.renameMailbox = async () => {
			throw Object.assign(new Error("Command failed"), {
				serverResponseCode: "NONEXISTENT",
				responseText: "Mailbox doesn't exist: Archive",
			});
		};

		await assert.doesNotReject(
			processMailboxManagement(renameEvent, noopLogger, deps()),
		);
		assert.deepEqual(called("mailbox.deleteMailboxWithMail")[0]?.args, [
			"acc-1",
			"mbx-1",
		]);
	});

	it("still refuses the intent and rethrows when a RENAME fails for any other reason", async () => {
		recordRenameIntent();
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
		assert.equal(lastSettle().to, "failed");
	});
});
