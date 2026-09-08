import {
	addressDetailOperationsUpdateAddressMutation,
	addressOperationsSearchAddressesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	AddressOperationsSearchAddressesResponse,
	RemitImapAddressFlagKey,
	RemitImapAddressFlags,
	RemitImapUpdateAddressFlagsInput,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { formatErrorDetail } from "@/components/ui/error-banners";
import { reportFatalError } from "@/lib/fatal-error";
import { senderAddressSearchQuery } from "@/lib/sender-address";

interface UseUpdateAddressFlagsOptions {
	addressId: string | undefined;
	/** The normalizedEmail of the sender — used to key the address search cache. */
	senderEmail: string | undefined;
}

interface MutationContext {
	previous: AddressOperationsSearchAddressesResponse | undefined;
}

/**
 * Apply a flag update onto an existing AddressFlags object. Each key in
 * `patch` is a flag update object; each key in `clear` is removed outright,
 * after the patch, matching the server's ordering. Mirrors the server-side
 * merge semantics so the optimistic cache matches what the API returns. Typed
 * loosely (the per-key flag value types differ — boolean for most, a category
 * enum for `category`) and re-narrowed at the return.
 */
function applyFlagPatch(
	current: RemitImapAddressFlags | undefined,
	patch: RemitImapUpdateAddressFlagsInput,
	clear: readonly RemitImapAddressFlagKey[] = [],
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
	for (const key of clear) {
		delete next[key];
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
		query: senderAddressSearchQuery(senderEmail),
	});

	const { mutate, isPending } = useMutation({
		...addressDetailOperationsUpdateAddressMutation(),
		onMutate: async (vars): Promise<MutationContext> => {
			const patch = vars.body.flags ?? {};
			const clear = vars.body.clearFlags ?? [];
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
								? { ...addr, flags: applyFlagPatch(addr.flags, patch, clear) }
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
				error: err,
			});
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: addressCacheKey });
		},
	});

	const submit = useCallback(
		(body: {
			flags?: RemitImapUpdateAddressFlagsInput;
			clearFlags?: RemitImapAddressFlagKey[];
		}) => {
			if (!addressId) {
				reportFatalError(
					new Error(
						`Quick action fired but the sender's address record did not resolve (sender: ${senderEmail ?? "unknown"}). This should never happen — the address row exists.`,
					),
				);
				return;
			}
			mutate({ path: { addressId }, body });
		},
		[addressId, mutate, senderEmail],
	);

	const updateFlags = useCallback(
		(flags: RemitImapUpdateAddressFlagsInput) => submit({ flags }),
		[submit],
	);

	/**
	 * Remove flags outright. This is the removal form for every flag whatever
	 * its value type: `category` holds an enum with no false-equivalent member,
	 * so `{ value: false }` cannot express "no override" for it.
	 */
	const clearFlags = useCallback(
		(keys: RemitImapAddressFlagKey[]) => submit({ clearFlags: keys }),
		[submit],
	);

	return { updateFlags, clearFlags, isPending };
}
