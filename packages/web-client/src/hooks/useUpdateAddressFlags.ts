import {
	addressDetailOperationsUpdateAddressMutation,
	addressOperationsSearchAddressesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	AddressOperationsSearchAddressesResponse,
	RemitImapAddressFlags,
	RemitImapUpdateAddressFlagsInput,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";

interface UseUpdateAddressFlagsOptions {
	addressId: string | undefined;
	/** The normalizedEmail of the sender — used to key the address search cache. */
	senderEmail: string | undefined;
}

interface MutationContext {
	previous: AddressOperationsSearchAddressesResponse | undefined;
}

/**
 * Apply a flag-update patch onto an existing AddressFlags object. Each key in
 * `patch` is a flag update object (set) or `null` (remove). Mirrors the
 * server-side merge semantics so the optimistic cache matches what the API
 * returns. Typed loosely (the per-key flag value types differ — boolean for
 * most, a category enum for `category`) and re-narrowed at the return.
 */
function applyFlagPatch(
	current: RemitImapAddressFlags | undefined,
	patch: RemitImapUpdateAddressFlagsInput,
): RemitImapAddressFlags {
	const next: Record<string, unknown> = { ...(current ?? {}) };
	for (const [key, update] of Object.entries(patch)) {
		if (update == null) {
			delete next[key];
		} else {
			// Each flag is `{ value, setAt? }`. Stamp setAt so the optimistic
			// shape matches what the server writes back.
			next[key] = { ...update, setAt: update.setAt ?? Date.now() };
		}
	}
	return next as RemitImapAddressFlags;
}

/**
 * Optimistic PATCH for per-sender flags (VIP / Mute / Block / Unsubscribe).
 * Mirrors the `useToggleTrusted` pattern: patch the cached
 * address-search response so the toggle flips instantly, roll back on error,
 * and invalidate on settle to reconcile with the server.
 */
export function useUpdateAddressFlags({
	addressId,
	senderEmail,
}: UseUpdateAddressFlagsOptions) {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const addressCacheKey = addressOperationsSearchAddressesQueryKey({
		query: { q: senderEmail ?? "", limit: 1 },
	});

	const { mutate, isPending } = useMutation({
		...addressDetailOperationsUpdateAddressMutation(),
		onMutate: async (vars): Promise<MutationContext> => {
			const patch = vars.body.flags ?? {};
			await queryClient.cancelQueries({ queryKey: addressCacheKey });

			const previous =
				queryClient.getQueryData<AddressOperationsSearchAddressesResponse>(
					addressCacheKey,
				);

			queryClient.setQueryData<AddressOperationsSearchAddressesResponse>(
				addressCacheKey,
				(old) => {
					if (!old) return old;
					return {
						...old,
						items: old.items.map((addr) =>
							addr.addressId === vars.path.addressId
								? { ...addr, flags: applyFlagPatch(addr.flags, patch) }
								: addr,
						),
					};
				},
			);

			return { previous };
		},
		onError: (err, _vars, context) => {
			if (context?.previous !== undefined) {
				queryClient.setQueryData(addressCacheKey, context.previous);
			}
			pushError({
				title: "Couldn't update sender preference",
				detail: formatErrorDetail(err),
			});
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: addressCacheKey });
		},
	});

	const updateFlags = useCallback(
		(flags: RemitImapUpdateAddressFlagsInput) => {
			if (!addressId) {
				// The sender's address record hasn't resolved yet (the lookup is in
				// flight or failed). Surface feedback rather than silently swallowing
				// the tap — a quick action must never look active but do nothing.
				pushError({
					title: "Sender details still loading",
					detail: "Try again in a moment.",
				});
				return;
			}
			mutate({ path: { addressId }, body: { flags } });
		},
		[addressId, mutate, pushError],
	);

	return { updateFlags, isPending };
}
