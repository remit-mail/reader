import {
	addressDetailOperationsUpdateAddressMutation,
	messageOperationsDescribeMessageQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAddressFlags,
	RemitImapDescribeMessageResponse,
	RemitImapEnvelopeAddressResponse,
	RemitImapTrustedFlag,
} from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface UseToggleTrustedOptions {
	messageId: string;
}

interface SnapshotEntry {
	queryKey: readonly unknown[];
	data: RemitImapDescribeMessageResponse;
}

interface ToggleTrustedContext {
	describePrefix: readonly unknown[];
	previous: SnapshotEntry[];
}

export const buildTrustedFlag = (
	nextTrusted: boolean,
	now: number = Date.now(),
): RemitImapTrustedFlag => ({
	value: nextTrusted,
	setAt: now,
});

export const patchEnvelopeAddress = (
	addr: RemitImapEnvelopeAddressResponse,
	addressId: string,
	nextTrusted: boolean,
	now?: number,
): RemitImapEnvelopeAddressResponse => {
	if (addr.addressId !== addressId) return addr;
	const flags: RemitImapAddressFlags = { ...(addr.flags ?? {}) };
	if (nextTrusted) {
		flags.trusted = buildTrustedFlag(true, now);
	} else {
		delete flags.trusted;
	}
	return { ...addr, flags };
};

export const patchDescribeMessage = (
	data: RemitImapDescribeMessageResponse,
	addressId: string,
	nextTrusted: boolean,
	now?: number,
): RemitImapDescribeMessageResponse => {
	const map = (list: RemitImapEnvelopeAddressResponse[]) =>
		list.map((addr) => patchEnvelopeAddress(addr, addressId, nextTrusted, now));
	return {
		...data,
		envelope: {
			...data.envelope,
			from: map(data.envelope.from),
			to: map(data.envelope.to),
			cc: map(data.envelope.cc),
			bcc: map(data.envelope.bcc),
			replyTo: map(data.envelope.replyTo),
		},
	};
};

/**
 * Toggle the per-sender `trusted` flag for an Address. Mirrors the optimistic-
 * update + rollback pattern from `useToggleStar`: we patch every cached
 * `describeMessage` response that mentions this address so the UI flips
 * instantly, then roll back on error per the project's "never hide failure"
 * rule (no toast — the caller is expected to surface the mutation error
 * through the existing ErrorState path).
 */
export const useToggleTrusted = ({ messageId }: UseToggleTrustedOptions) => {
	const queryClient = useQueryClient();

	const { mutate, isPending, error, reset } = useMutation({
		...addressDetailOperationsUpdateAddressMutation(),
		onMutate: async (vars): Promise<ToggleTrustedContext> => {
			const addressId = vars.path.addressId;
			const trustedPatch = vars.body.flags?.trusted;
			const nextTrusted = trustedPatch?.value === true;

			const describePrefix = messageOperationsDescribeMessageQueryKey({
				path: { messageId },
			});

			await queryClient.cancelQueries({ queryKey: describePrefix });

			const previous = queryClient
				.getQueriesData<RemitImapDescribeMessageResponse>({
					queryKey: describePrefix,
				})
				.filter(
					(
						entry,
					): entry is [readonly unknown[], RemitImapDescribeMessageResponse] =>
						entry[1] !== undefined,
				)
				.map(([queryKey, data]) => ({ queryKey, data }));

			queryClient.setQueriesData<RemitImapDescribeMessageResponse>(
				{ queryKey: describePrefix },
				(old) =>
					old ? patchDescribeMessage(old, addressId, nextTrusted) : old,
			);

			return { describePrefix, previous };
		},
		onError: (_err, _vars, context) => {
			if (!context) return;
			for (const entry of context.previous) {
				queryClient.setQueryData(entry.queryKey, entry.data);
			}
		},
		onSettled: (_data, _err, _vars, context) => {
			if (!context) return;
			queryClient.invalidateQueries({ queryKey: context.describePrefix });
		},
	});

	const toggleTrusted = (addressId: string, currentlyTrusted: boolean) => {
		const next = !currentlyTrusted;
		// Always send a TrustedFlag object (value: true|false). The schema
		// nominally accepts `trusted: null` to remove the flag, but our
		// openapi-backend validator doesn't honour `nullable: true` on a
		// schema wrapped in `allOf: [$ref]` (which is how TypeSpec emits
		// `TrustedFlag | null` for OAS 3.0), so the server rejected untrust
		// requests as invalid. `{ value: false }` reads as "not trusted"
		// everywhere (every check is `flags?.trusted?.value === true`) and
		// also leaves an audit timestamp on the flag.
		mutate({
			path: { addressId },
			body: {
				flags: {
					trusted: buildTrustedFlag(next),
				},
			},
		});
	};

	return { toggleTrusted, isPending, error, reset };
};
