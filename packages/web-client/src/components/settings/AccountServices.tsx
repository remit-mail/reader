import {
	accountDetailOperationsUpdateAccountMutation,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	type AccountService,
	type AccountServiceChange,
	AccountServiceChangeDialog,
	type AccountServiceIntent,
} from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { softErrorMeta } from "@/lib/error-classifier";
import {
	type AccountServiceRefusal,
	AccountServicesCard,
} from "./AccountServicesCard";

const SERVICES: AccountService[] = ["Mail", "Calendar"];
const PROVIDER_NAME = "Microsoft";

const offeredServices = (
	account: RemitImapAccountResponse,
): AccountService[] =>
	account.authType === "oauthMicrosoft" ? SERVICES : ["Mail"];

const withService = (
	services: AccountService[],
	service: AccountService,
): AccountService[] =>
	SERVICES.filter(
		(candidate) => candidate === service || services.includes(candidate),
	);

export interface AccountServicesProps {
	account: RemitImapAccountResponse;
	onRemoveAccount: () => void;
}

export function AccountServices({
	account,
	onRemoveAccount,
}: AccountServicesProps) {
	const queryClient = useQueryClient();
	const [change, setChange] = useState<AccountServiceChange | null>(null);
	const [refusal, setRefusal] = useState<AccountServiceRefusal | null>(null);

	const mutation = useMutation({
		...accountDetailOperationsUpdateAccountMutation(),
		meta: softErrorMeta,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			}),
	});

	const enabled =
		mutation.isPending && mutation.variables?.body.syncedServices
			? mutation.variables.body.syncedServices
			: account.syncedServices;

	const commit = (
		services: AccountService[],
		service: AccountService,
		intent: AccountServiceIntent,
	) => {
		setRefusal(null);
		mutation.mutate(
			{
				path: { accountId: account.accountId },
				body: { syncedServices: services },
			},
			{
				onError: (error) =>
					setRefusal({ service, intent, message: formatErrorMessage(error) }),
			},
		);
	};

	const requestChange = (
		service: AccountService,
		intent: AccountServiceIntent,
	) => {
		if (intent === "off") {
			setChange({ kind: enabled.length === 1 ? "last" : "disable", service });
			return;
		}
		commit(withService(enabled, service), service, "on");
	};

	const confirm = () => {
		const confirmed = change;
		setChange(null);
		if (confirmed?.kind === "last") {
			onRemoveAccount();
			return;
		}
		if (confirmed?.kind !== "disable") return;
		commit(
			enabled.filter((service) => service !== confirmed.service),
			confirmed.service,
			"off",
		);
	};

	return (
		<>
			<AccountServicesCard
				providerName={PROVIDER_NAME}
				offered={offeredServices(account)}
				enabled={enabled}
				refusal={refusal}
				onRequestChange={requestChange}
			/>
			<AccountServiceChangeDialog
				change={change}
				providerName={PROVIDER_NAME}
				onConfirm={confirm}
				onCancel={() => setChange(null)}
			/>
		</>
	);
}
