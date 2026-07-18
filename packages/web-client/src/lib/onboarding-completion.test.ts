/**
 * The onboarding wizard creates the account server-side, then the user clicks
 * "Go to inbox". The /mail first-run guard redirects back to /onboarding while
 * the cached config still reports zero accounts, so completion must refresh
 * config and wait for it before navigating — otherwise the user loops back into
 * the wizard.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completeOnboarding } from "./onboarding-completion.js";

describe("completeOnboarding", () => {
	it("navigates to the inbox only after config is refreshed", async () => {
		const order: string[] = [];
		let resolveRefetch: (() => void) | undefined;

		const refetchQueries = () => {
			order.push("refetch:start");
			return new Promise<void>((resolve) => {
				resolveRefetch = () => {
					order.push("refetch:done");
					resolve();
				};
			});
		};

		const done = completeOnboarding({
			queryClient: { refetchQueries },
			recordCompleted: () => order.push("recorded"),
			navigateToInbox: () => order.push("navigate"),
		});

		// Refetch is in flight; navigation must not have happened yet.
		await Promise.resolve();
		assert.deepEqual(order, ["recorded", "refetch:start"]);

		resolveRefetch?.();
		await done;

		assert.deepEqual(order, [
			"recorded",
			"refetch:start",
			"refetch:done",
			"navigate",
		]);
	});

	it("refreshes the config query", async () => {
		let refetchedKey: unknown;
		await completeOnboarding({
			queryClient: {
				refetchQueries: (filters) => {
					refetchedKey = (filters as { queryKey?: unknown }).queryKey;
					return Promise.resolve();
				},
			},
			recordCompleted: () => {},
			navigateToInbox: () => {},
		});

		assert.ok(refetchedKey, "refetchQueries called with a query key");
	});
});
