import assert from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { IImapConnection } from "@remit/mailbox-service";
import {
	__evictWarmConnectionsForTest,
	__resetWarmPoolsForTest,
	__warmPoolSizeForTest,
	borrowWarmConnection,
	type ConnectionScope,
} from "./connection-scope.js";

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

describe("borrowWarmConnection — cross-invocation warm reuse", () => {
	const accountId = "acct-warm-1";

	beforeEach(() => {
		__resetWarmPoolsForTest();
	});

	afterEach(async () => {
		await __evictWarmConnectionsForTest(accountId);
		__resetWarmPoolsForTest();
	});

	test("warm invocation reuses the live connection without reconnecting", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};

		const first = borrowWarmConnection(accountId, createScope);
		const connA = await first.getConnection();
		await first.release();

		const second = borrowWarmConnection(accountId, createScope);
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

		const first = borrowWarmConnection(accountId, createScope);
		await first.getConnection();
		await first.release();

		// Provider drops the idle socket: imapflow flips isConnected to false.
		scopes[0].kill();

		const second = borrowWarmConnection(accountId, createScope);
		const connB = await second.getConnection();
		await second.release();

		assert.strictEqual(scopes.length, 2, "a replacement scope was created");
		assert.strictEqual(scopes[0].disconnectCount, 1, "dead conn cleaned up");
		assert.strictEqual(scopes[1].connectCount, 1, "replacement connected once");
		assert.ok(connB.isConnected, "replacement connection is live");
		assert.strictEqual(
			__warmPoolSizeForTest(accountId),
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

		for (let i = 0; i < 20; i++) {
			const borrowed = borrowWarmConnection(accountId, createScope);
			await borrowed.getConnection();
			await borrowed.release();
		}

		assert.strictEqual(scopes.length, 1, "serial reuse never re-dials");
		assert.strictEqual(
			__warmPoolSizeForTest(accountId),
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

		const a = borrowWarmConnection(accountId, createScope);
		const b = borrowWarmConnection(accountId, createScope);
		const connA = await a.getConnection();
		const connB = await b.getConnection();

		assert.notStrictEqual(
			connA,
			connB,
			"concurrent borrows must not share one imapflow connection",
		);

		await a.release();
		await b.release();

		// default connectionsPerAccount is 2 — both stay pooled, none leaked.
		assert.strictEqual(__warmPoolSizeForTest(accountId), 2);
		assert.ok(scopes.every((s) => s.disconnectCount === 0));
	});

	test("overflow connection (pool saturated) is disconnected on release", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};

		// Saturate the pool (default size 2) with two held borrows.
		const a = borrowWarmConnection(accountId, createScope);
		const b = borrowWarmConnection(accountId, createScope);
		await a.getConnection();
		await b.getConnection();

		// Third concurrent borrow overflows the pool.
		const c = borrowWarmConnection(accountId, createScope);
		await c.getConnection();
		await c.release();

		assert.strictEqual(scopes.length, 3, "overflow created a third scope");
		assert.strictEqual(scopes[2].disconnectCount, 1, "overflow torn down");
		assert.strictEqual(
			__warmPoolSizeForTest(accountId),
			2,
			"overflow did not grow the pool",
		);

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

		// Seed the pool with a single connection, then kill it so it is a dead
		// FREE entry — the recycle path that recreates a scope across an awaited
		// disconnect (the race window).
		const seed = borrowWarmConnection(accountId, createScope);
		await seed.getConnection();
		await seed.release();
		scopes[0].kill();

		// Two borrows started before either resolves: both run their synchronous
		// claim phase, then A awaits disconnectQuietly while B's claim runs. The
		// dead entry must be claimed atomically so they never adopt the same slot.
		const a = borrowWarmConnection(accountId, createScope);
		const b = borrowWarmConnection(accountId, createScope);
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

		// One slot recycled in place + one grown = pool of 2 (default cap), no leak.
		assert.strictEqual(__warmPoolSizeForTest(accountId), 2);
	});

	test("__evictWarmConnectionsForTest disconnects and clears the pool", async () => {
		const scopes: FakeScope[] = [];
		const createScope = (): ConnectionScope => {
			const s = makeFakeScope();
			scopes.push(s);
			return s;
		};

		const borrowed = borrowWarmConnection(accountId, createScope);
		await borrowed.getConnection();
		await borrowed.release();

		await __evictWarmConnectionsForTest(accountId);

		assert.strictEqual(__warmPoolSizeForTest(accountId), 0);
		assert.strictEqual(
			scopes[0].disconnectCount,
			1,
			"evicted conn disconnected",
		);
	});
});
