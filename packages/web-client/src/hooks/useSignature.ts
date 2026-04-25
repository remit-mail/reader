import {
	accountDetailOperationsUpdateAccountMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

export interface SignatureData {
	html: string;
	plainText: string;
}

const EMPTY_SIGNATURE: SignatureData = { html: "", plainText: "" };

export const useSignature = (accountId?: string) => {
	const queryClient = useQueryClient();

	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	const signature = useMemo<SignatureData>(() => {
		if (!accountId || !config) return EMPTY_SIGNATURE;
		const account = config.accounts.find((a) => a.accountId === accountId);
		if (!account) return EMPTY_SIGNATURE;
		return {
			html: account.signatureHtml ?? "",
			plainText: account.signaturePlainText ?? "",
		};
	}, [accountId, config]);

	const mutation = useMutation({
		...accountDetailOperationsUpdateAccountMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
		},
	});

	const setSignature = useCallback(
		(html: string, plainText: string) => {
			if (!accountId) return;
			mutation.mutate({
				path: { accountId },
				body: { signatureHtml: html, signaturePlainText: plainText },
			});
		},
		[accountId, mutation],
	);

	return { signature, setSignature, isSaving: mutation.isPending };
};
