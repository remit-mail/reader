import {
	accountDetailOperationsUpdateAccountMutation,
	configOperationsGetConfigQueryKey,
	microsoftOAuthOperationsMicrosoftOAuthStartMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { microsoftServicesGranted } from "@remit/mail-oauth-service";
import {
	type AccountService,
	type AccountServiceChange,
	AccountServiceChangeDialog,
	type AccountServiceIntent,
} from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import {
	REDIRECT_STALL_MESSAGE,
	useRedirectEnded,
} from "@/hooks/useRedirectEnded";
import { softErrorMeta } from "@/lib/error-classifier";
import {
	type AccountServiceRefusal,
	AccountServicesCard,
} from "./AccountServicesCard";

const SERVICES: AccountService[] = ["Mail", "Calendar"];
const PROVIDER_NAME = "Microsoft";

const isMicrosoft = (account: RemitImapAccountResponse): boolean =>
	account.authType === "oauthMicrosoft";

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
	const [redirecting, setRedirecting] = useState<AccountService | null>(null);

	const save = useMutation({
		...accountDetailOperationsUpdateAccountMutation(),
		meta: softErrorMeta,
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			}),
	});

	const consent = useMutation({
		...microsoftOAuthOperationsMicrosoftOAuthStartMutation(),
		meta: softErrorMeta,
	});

	const markRedirectStarted = useRedirectEnded((end) => {
		const service = redirecting;
		setRedirecting(null);
		if (end !== "stalled" || service === null) return;
		setRefusal({ service, intent: "on", message: REDIRECT_STALL_MESSAGE });
	});

	const enabled =
		save.isPending && save.variables?.body.syncedServices
			? save.variables.body.syncedServices
			: account.syncedServices;
	const offered = isMicrosoft(account) ? SERVICES : ["Mail" as const];
	const consented = isMicrosoft(account)
		? microsoftServicesGranted(account.grantedScopes)
		: offered;

	const commit = (
		services: AccountService[],
		service: AccountService,
		intent: AccountServiceIntent,
	) => {
		setRefusal(null);
		save.mutate(
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

	const startConsent = (service: AccountService) => {
		setRefusal(null);
		consent.mutate(
			{
				body: {
					email: account.email,
					services: withService(enabled, service),
				},
			},
			{
				onSuccess: (data) => {
					setRedirecting(service);
					markRedirectStarted();
					window.location.assign(data.authorizationUrl);
				},
				onError: (error) =>
					setRefusal({
						service,
						intent: "on",
						message: formatErrorMessage(error),
					}),
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
		if (!consented.includes(service)) {
			setChange({ kind: "enable", service });
			return;
		}
		commit(withService(enabled, service), service, "on");
	};

	const confirm = () => {
		const confirmed = change;
		setChange(null);
		if (confirmed === null) return;
		if (confirmed.kind === "last") {
			onRemoveAccount();
			return;
		}
		if (confirmed.kind === "enable") {
			startConsent(confirmed.service);
			return;
		}
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
				offered={offered}
				enabled={enabled}
				consented={consented}
				disabled={save.isPending || consent.isPending || redirecting !== null}
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
