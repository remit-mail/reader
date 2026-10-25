import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configOperationsGetConfigQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { QueryClient } from "@tanstack/react-query";
import {
	createStaleBuildWatch,
	STALE_BUILD_RELOAD_KEY_PREFIX,
	type StaleBuildWatch,
	watchConfigBuildCommit,
} from "./stale-build";

const memoryGuard = (): Pick<Storage, "getItem" | "setItem"> => {
	const store = new Map<string, string>();
	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
	};
};

const harness = (guard = memoryGuard()) => {
	let reloads = 0;
	const watch = createStaleBuildWatch({
		reload: () => {
			reloads += 1;
		},
		guard,
		bundleCommit: "bundle-sha",
	});
	return { watch, guard, reloads: () => reloads };
};

describe("createStaleBuildWatch", () => {
	it("does not reload while config keeps answering the boot commit", () => {
		const { watch, reloads } = harness();
		watch.observeBuildCommit("aaa");
		watch.observeBuildCommit("aaa");
		assert.equal(reloads(), 0);
	});

	it("reloads once when config answers a different commit", () => {
		const { watch, guard, reloads } = harness();
		watch.observeBuildCommit("aaa");
		watch.observeBuildCommit("bbb");
		watch.observeBuildCommit("bbb");
		assert.equal(reloads(), 1);
		assert.notEqual(guard.getItem(`${STALE_BUILD_RELOAD_KEY_PREFIX}aaa`), null);
	});

	it("does not reload away from a commit it already reloaded away from", () => {
		const guard = memoryGuard();
		guard.setItem(`${STALE_BUILD_RELOAD_KEY_PREFIX}aaa`, "1");
		const { watch, reloads } = harness(guard);
		watch.observeBuildCommit("aaa");
		watch.observeBuildCommit("bbb");
		assert.equal(reloads(), 0);
	});

	it("reloads once on a chunk-load failure, keyed by the boot commit", () => {
		const { watch, guard, reloads } = harness();
		watch.observeBuildCommit("aaa");
		assert.equal(watch.chunkLoadFailed(), true);
		assert.equal(watch.chunkLoadFailed(), false);
		assert.equal(reloads(), 1);
		assert.notEqual(guard.getItem(`${STALE_BUILD_RELOAD_KEY_PREFIX}aaa`), null);
	});

	it("keys a chunk-load failure by the bundle commit before config answered", () => {
		const { watch, guard } = harness();
		assert.equal(watch.chunkLoadFailed(), true);
		assert.notEqual(
			guard.getItem(`${STALE_BUILD_RELOAD_KEY_PREFIX}bundle-sha`),
			null,
		);
	});

	it("never reloads without a place to remember the reload", () => {
		let reloads = 0;
		const watch = createStaleBuildWatch({
			reload: () => {
				reloads += 1;
			},
			guard: null,
			bundleCommit: "bundle-sha",
		});
		watch.observeBuildCommit("aaa");
		watch.observeBuildCommit("bbb");
		assert.equal(watch.chunkLoadFailed(), false);
		assert.equal(reloads, 0);
	});
});

describe("watchConfigBuildCommit", () => {
	it("feeds every config answer's buildCommit to the watch, and nothing else", () => {
		const seen: string[] = [];
		const watch: StaleBuildWatch = {
			observeBuildCommit: (commit) => {
				seen.push(commit);
			},
			chunkLoadFailed: () => false,
		};
		const queryClient = new QueryClient();
		const stop = watchConfigBuildCommit(queryClient, watch);

		queryClient.setQueryData(configOperationsGetConfigQueryKey(), {
			buildCommit: "aaa",
		});
		queryClient.setQueryData(["unrelated"], { buildCommit: "zzz" });
		queryClient.setQueryData(configOperationsGetConfigQueryKey(), {
			buildCommit: "bbb",
		});
		stop();
		queryClient.clear();

		assert.deepEqual(seen, ["aaa", "bbb"]);
	});
});
