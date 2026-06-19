/**
 * Draft-discard must surface a banner on a soft failure.
 *
 * `ComposeForm.handleDiscard` closes the compose dialog optimistically, then
 * fires the delete mutation. Before #741 the delete had no `onError`, so a soft
 * 4xx (409/404 "the draft is already gone") closed the dialog as if it
 * succeeded — silent discard. The fix adds an `onError` that pushes a banner via
 * `buildMutationErrorBanner("Couldn't discard draft", …)`, mirroring the
 * outbox-delete pattern. A fatal 5xx still escalates globally; this pins the
 * non-fatal branch.
 *
 * Exercising the real mutation `onError` headlessly (no DOM) via the same
 * `MutationCache` wiring `ComposeForm` uses through `QueryClient`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "../../lib/api.js";
import {
	buildMutationErrorBanner,
	type PushErrorInput,
} from "../ui/error-banners.js";

describe("draft discard surfaces a banner on a soft failure (#741)", () => {
	const buildDiscardMutation = (
		pushError: (input: PushErrorInput) => void,
		fail: () => Promise<never>,
	) => {
		const client = new QueryClient({
			mutationCache: new MutationCache(),
		});
		return client.getMutationCache().build(client, {
			mutationFn: fail,
			onError: (error: unknown) => {
				pushError(
					buildMutationErrorBanner(
						"Couldn't discard draft",
						"The draft wasn't discarded.",
						error,
					),
				);
			},
		});
	};

	it("pushes a 'Couldn't discard draft' banner on a 409 already-gone", async () => {
		const pushed: PushErrorInput[] = [];
		const mutation = buildDiscardMutation(
			(input) => pushed.push(input),
			async () => {
				throw new ApiError("Draft already deleted", 409);
			},
		);

		await mutation.execute(undefined).catch(() => {});

		assert.equal(pushed.length, 1);
		assert.equal(pushed[0].title, "Couldn't discard draft");
		assert.equal(pushed[0].detail, "Draft already deleted");
	});

	it("falls back to a human detail when the error carries no message", async () => {
		const pushed: PushErrorInput[] = [];
		const mutation = buildDiscardMutation(
			(input) => pushed.push(input),
			async () => {
				throw {};
			},
		);

		await mutation.execute(undefined).catch(() => {});

		assert.equal(pushed[0].detail, "The draft wasn't discarded.");
	});
});
