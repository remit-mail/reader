import assert from "node:assert";
import { describe, test } from "node:test";
import type { IImapConnection, MailCredentials } from "@remit/mailbox-service";
import {
	type ConnectionPoolOptions,
	createConnectionPool,
	type PoolAccount,
} from "./connection-pool.js";
import type { ConnectionScope } from "./connection-scope.js";

/**
 * A fake connection whose liveness can be toggled, recording connect/disconnect
 * so tests can assert reuse (no reconnect) and leak-freedom (every connect is
 * eventually disconnected or reused, never dangling).
 */
interface FakeScope extends ConnectionScope {
	id: number;
	connectCount: number;
	disconnectCount: number;
	kill: () => void;
}

let nextId = 0;

const makeFakeScope = (): FakeScope => {
	const id = nextId++;
	let alive = true;
	let conn: IImapConnection | null = null;

	const scope: FakeScope = {
		id,
		connectCount: 0,
		disconnectCount: 0,
		kill: () => {
			alive = false;
		},
		getConnection: async () => {
			if (!conn) {
				scope.connectCount++;
				conn = {
					get isConnected() {
						return alive;
					},
				} as IImapConnection;
			}
			return conn;
		},
		disconnect: async () => {
			scope.disconnectCount++;
			conn = null;
		},
	};
	return scope;
};

const accountId = "acct-warm-1";

const account: PoolAccount = {
	accountId,
	username: "person@example.com",
	imapHost: "imap.example.com",
	imapPort: 993,
	imapTls: true,
};

const credentials: MailCredentials = { kind: "password", password: "secret" };

const LAMBDA: ConnectionPoolOptions = { size: 2, overflow: "Open" };

const poolOver = (
	createScope: () => ConnectionScope,
	options: ConnectionPoolOptions = LAMBDA,
) => {
	const pool = createConnectionPool(options, () => createScope());
	return {
		borrow: () => pool.borrow(account, credentials),
		pooled: () => pool.pooled(accountId),
		drain: pool.drain,
	};
};

describe("a connection pool of two that opens on overflow", () => {
	test("warm invocation reuses the live connection without reconnecting", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};
		const pool = poolOver(createScope);

		const first = pool.borrow();
		const connA = await first.getConnection();
		await first.release();

		const second = pool.borrow();
		const connB = await second.getConnection();
		await second.release();

		assert.strictEqual(
			connA,
			connB,
			"second invocation reuses same connection",
		);
		assert.strictEqual(scopes.length, 1, "no second scope created");
		assert.strictEqual(scopes[0].connectCount, 1, "connected exactly once");
		assert.strictEqual(scopes[0].disconnectCount, 0, "never disconnected");
	});

	test("dead connection triggers reconnect and replaces the cache entry", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};
		const pool = poolOver(createScope);

		const first = pool.borrow();
		await first.getConnection();
		await first.release();

		// Provider drops the idle socket: imapflow flips isConnected to false.
		scopes[0].kill();

		const second = pool.borrow();
		const connB = await second.getConnection();
		await second.release();

		assert.strictEqual(scopes.length, 2, "a replacement scope was created");
		assert.strictEqual(scopes[0].disconnectCount, 1, "dead conn cleaned up");
		assert.strictEqual(scopes[1].connectCount, 1, "replacement connected once");
		assert.ok(connB.isConnected, "replacement connection is live");
		assert.strictEqual(
			pool.pooled(),
			1,
			"pool did not grow when replacing a dead entry",
		);
	});

	test("no connection leak: pool size stays bounded across many invocations", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};
		const pool = poolOver(createScope);

		for (let i = 0; i < 20; i++) {
			const borrowed = pool.borrow();
			await borrowed.getConnection();
			await borrowed.release();
		}

		assert.strictEqual(scopes.length, 1, "serial reuse never re-dials");
		assert.strictEqual(
			pool.pooled(),
			1,
			"pool stays at one for serial same-account work",
		);
	});

	test("concurrent same-account borrows get distinct pooled connections", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};
		const pool = poolOver(createScope);

		const a = pool.borrow();
		const b = pool.borrow();
		const connA = await a.getConnection();
		const connB = await b.getConnection();

		assert.notStrictEqual(
			connA,
			connB,
			"concurrent borrows must not share one imapflow connection",
		);

		await a.release();
		await b.release();

		// Both stay pooled, none leaked.
		assert.strictEqual(pool.pooled(), 2);
		assert.ok(scopes.every((s) => s.disconnectCount === 0));
	});

	test("overflow connection (pool saturated) is disconnected on release", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};
		const pool = poolOver(createScope);

		// Saturate the pool with two held borrows.
		const a = pool.borrow();
		const b = pool.borrow();
		await a.getConnection();
		await b.getConnection();

		// Third concurrent borrow overflows the pool.
		const c = pool.borrow();
		await c.getConnection();
		await c.release();

		assert.strictEqual(scopes.length, 3, "overflow created a third scope");
		assert.strictEqual(scopes[2].disconnectCount, 1, "overflow torn down");
		assert.strictEqual(pool.pooled(), 2, "overflow did not grow the pool");

		await a.release();
		await b.release();
	});

	test("concurrent borrows racing on a dead pooled entry get distinct connections", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};
		const pool = poolOver(createScope);

		// Seed the pool with a single connection, then kill it so it is a dead
		// FREE entry — the recycle path that recreates a scope across an awaited
		// disconnect (the race window).
		const seed = pool.borrow();
		await seed.getConnection();
		await seed.release();
		scopes[0].kill();

		// Two borrows started before either resolves: both run their synchronous
		// claim phase, then A awaits disconnectQuietly while B's claim runs. The
		// dead entry must be claimed atomically so they never adopt the same slot.
		const a = pool.borrow();
		const b = pool.borrow();
		const [connA, connB] = await Promise.all([
			a.getConnection(),
			b.getConnection(),
		]);

		assert.notStrictEqual(
			connA,
			connB,
			"racing borrows must not share one imapflow connection",
		);
		assert.ok(connA.isConnected && connB.isConnected, "both are live");

		await a.release();
		await b.release();

		// One slot recycled in place + one grown = pool of 2 , no leak.
		assert.strictEqual(pool.pooled(), 2);
	});

	test("drain disconnects and clears the pool", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};
		const pool = poolOver(createScope);

		const borrowed = pool.borrow();
		await borrowed.getConnection();
		await borrowed.release();

		await pool.drain();

		assert.strictEqual(pool.pooled(), 0);
		assert.strictEqual(
			scopes[0].disconnectCount,
			1,
			"drained conn disconnected",
		);
	});
});

describe("a connection pool of one that waits on overflow", () => {
	const WORKER: ConnectionPoolOptions = { size: 1, overflow: "Wait" };

	test("serialises two borrows of one account on one connection", async () => {
		const scopes: FakeScope[] = [];
		const pool = poolOver(() => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		}, WORKER);
		const steps: string[] = [];
		const work = async (name: string) => {
			const borrowed = pool.borrow();
			const connection = await borrowed.getConnection();
			steps.push(`${name} start`);
			await new Promise((resolve) => setTimeout(resolve, 5));
			steps.push(`${name} end`);
			await borrowed.release();
			return connection;
		};

		const [first, second] = await Promise.all([work("a"), work("b")]);

		assert.deepStrictEqual(steps, ["a start", "a end", "b start", "b end"]);
		assert.strictEqual(first, second, "the second borrow reuses the first");
		assert.strictEqual(scopes.length, 1, "no second connection is opened");
		assert.strictEqual(pool.pooled(), 1);
	});

	test("hands a released connection to waiters in arrival order", async () => {
		const pool = poolOver(makeFakeScope, WORKER);
		const holder = pool.borrow();
		await holder.getConnection();
		const order: string[] = [];
		const waitFor = (name: string) => {
			const borrowed = pool.borrow();
			return borrowed.getConnection().then(async () => {
				order.push(name);
				await borrowed.release();
			});
		};

		const waiting = Promise.all([waitFor("b"), waitFor("c")]);
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepStrictEqual(order, [], "nobody runs while the slot is held");

		await holder.release();
		await waiting;

		assert.deepStrictEqual(order, ["b", "c"]);
	});

	test("replaces a connection that died while a borrower waited for it", async () => {
		const scopes: FakeScope[] = [];
		const pool = poolOver(() => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		}, WORKER);
		const holder = pool.borrow();
		await holder.getConnection();
		const waiter = pool.borrow();
		const handedOver = waiter.getConnection();

		scopes[0].kill();
		await holder.release();
		const connection = await handedOver;
		await waiter.release();

		assert.strictEqual(scopes.length, 2, "a replacement scope was created");
		assert.strictEqual(scopes[0].disconnectCount, 1, "dead conn cleaned up");
		assert.ok(connection.isConnected, "the waiter got a live connection");
		assert.strictEqual(pool.pooled(), 1);
	});
});
