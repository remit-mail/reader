/**
 * A deploy removes the lazy chunks the running shell was built with, so the
 * next route that loads one fails (#1432). Two signals mean the page is running
 * a superseded build: a `GET /config` answering a `buildCommit` other than the
 * one this page booted against, and a dynamic import that fails to load. Either
 * reloads the page — once per build left behind, so a deploy that keeps
 * flipping between builds, or a chunk that is missing from the new build too,
 * cannot spin the tab in a reload loop.
 */
import { configOperationsGetConfigQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { hashKey, type QueryClient } from "@tanstack/react-query";
import { APP_SHA } from "@/lib/app-info";

export const STALE_BUILD_RELOAD_KEY_PREFIX = "remit.stale-build-reload:";

type ReloadGuard = Pick<Storage, "getItem" | "setItem">;

export interface StaleBuildPorts {
	reload: () => void;
	guard: ReloadGuard | null;
	bundleCommit: string;
}

export interface StaleBuildWatch {
	observeBuildCommit: (commit: string) => void;
	chunkLoadFailed: () => boolean;
}

export const createStaleBuildWatch = ({
	reload,
	guard,
	bundleCommit,
}: StaleBuildPorts): StaleBuildWatch => {
	let bootCommit: string | null = null;

	const reloadLeaving = (commit: string): boolean => {
		if (guard === null) return false;
		const key = `${STALE_BUILD_RELOAD_KEY_PREFIX}${commit}`;
		if (guard.getItem(key) !== null) return false;
		guard.setItem(key, String(Date.now()));
		reload();
		return true;
	};

	return {
		observeBuildCommit: (commit) => {
			if (bootCommit === null) {
				bootCommit = commit;
				return;
			}
			if (commit === bootCommit) return;
			reloadLeaving(bootCommit);
		},
		chunkLoadFailed: () => reloadLeaving(bootCommit ?? bundleCommit),
	};
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

export const buildCommitOf = (data: unknown): string | null =>
	isRecord(data) && typeof data.buildCommit === "string"
		? data.buildCommit
		: null;

const sessionGuard = (): ReloadGuard | null => {
	try {
		return globalThis.sessionStorage ?? null;
	} catch {
		return null;
	}
};

export const watchConfigBuildCommit = (
	queryClient: QueryClient,
	watch: StaleBuildWatch,
): (() => void) => {
	const configHash = hashKey(configOperationsGetConfigQueryKey());
	return queryClient.getQueryCache().subscribe((event) => {
		if (event.type !== "updated" || event.action.type !== "success") return;
		if (event.query.queryHash !== configHash) return;
		const commit = buildCommitOf(event.query.state.data);
		if (commit !== null) watch.observeBuildCommit(commit);
	});
};

export const installStaleBuildReload = (queryClient: QueryClient): void => {
	const watch = createStaleBuildWatch({
		reload: () => window.location.reload(),
		guard: sessionGuard(),
		bundleCommit: APP_SHA,
	});
	watchConfigBuildCommit(queryClient, watch);

	window.addEventListener("vite:preloadError", (event) => {
		if (watch.chunkLoadFailed()) event.preventDefault();
	});
};
