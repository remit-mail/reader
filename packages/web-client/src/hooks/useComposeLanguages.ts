import {
	accountDetailOperationsUpdateAccountMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { defaultComposeLanguages } from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";

/**
 * The account's writing languages: the menu the composer's language chip
 * offers, and the set detection is allowed to choose inside. Absent on the
 * server means the user has never been here, and the browser's own ordered
 * answer stands in.
 */
export const useComposeLanguages = (accountId?: string) => {
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();

	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	const configured = config?.accounts.find(
		(account) => account.accountId === accountId,
	)?.composeLanguages;

	const languages = useMemo<string[]>(
		() =>
			configured && configured.length > 0
				? [...configured]
				: defaultComposeLanguages(navigator.languages),
		[configured],
	);

	const mutation = useMutation({
		...accountDetailOperationsUpdateAccountMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
		},
		onError: (error) => {
			pushError(
				buildMutationErrorBanner(
					"Couldn't save languages",
					"The writing languages weren't saved.",
					error,
				),
			);
		},
	});

	const setLanguages = useCallback(
		(next: string[]) => {
			if (!accountId) return;
			mutation.mutate({
				path: { accountId },
				body: { composeLanguages: next },
			});
		},
		[accountId, mutation],
	);

	return { languages, setLanguages, isSaving: mutation.isPending };
};
