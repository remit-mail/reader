import type {
	AccountOperationsCreateAccountResponse,
	AccountOperationsTestConnectionResponse,
	MicrosoftOAuthOperationsMicrosoftOAuthStartResponse,
	RemitImapAccountSyncStatusResponse,
	SyncOperationsGetSyncStatusResponse,
} from "@remit/api-http-client/types.gen.ts";
import { type HttpHandler, HttpResponse, http } from "msw";
import { makeAccount } from "@/test-support/fixtures";

const API = "/api";

export const NEW_ACCOUNT_ID = "acc-new";

export type Autoconfig = "found" | "missing" | "slow";

export interface OnboardingHandlerOptions {
	autoconfig?: Autoconfig;
	connection?: AccountOperationsTestConnectionResponse;
	createFails?: boolean;
	sync?: Omit<RemitImapAccountSyncStatusResponse, "accountId">;
}

const autoconfigXml = (domain: string): string => `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="${domain}">
    <incomingServer type="imap">
      <hostname>mail.${domain}</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>mail.${domain}</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

const pending = (): Promise<never> => new Promise<never>(() => undefined);

const autoconfigHandlers = (autoconfig: Autoconfig): HttpHandler[] => [
	http.get("https://autoconfig.thunderbird.net/v1.1/:domain", ({ params }) => {
		if (autoconfig === "slow") return pending();
		if (autoconfig === "missing")
			return new HttpResponse(null, { status: 404 });
		return HttpResponse.text(autoconfigXml(String(params.domain)), {
			headers: { "Content-Type": "application/xml" },
		});
	}),
	http.get(
		/^https:\/\/autoconfig\.[^/]+\/mail\/config-v1\.1\.xml$/,
		() => new HttpResponse(null, { status: 404 }),
	),
];

export const onboardingHandlers = ({
	autoconfig = "found",
	connection = { imapSuccess: true, smtpSuccess: true },
	createFails = false,
	sync = {
		syncPhase: "complete",
		mailboxCountTotal: 6,
		mailboxCountSynced: 6,
		mailboxes: [],
	},
}: OnboardingHandlerOptions = {}): HttpHandler[] => [
	...autoconfigHandlers(autoconfig),
	http.post(`${API}/accounts/test-connection`, () =>
		HttpResponse.json<AccountOperationsTestConnectionResponse>(connection),
	),
	http.post(`${API}/accounts`, async ({ request }) => {
		if (createFails) return HttpResponse.error();
		const body: unknown = await request.json();
		const email =
			typeof body === "object" &&
			body !== null &&
			"email" in body &&
			typeof body.email === "string"
				? body.email
				: "alice@northwind.example";
		return HttpResponse.json<AccountOperationsCreateAccountResponse>(
			makeAccount({ accountId: NEW_ACCOUNT_ID, email }),
		);
	}),
	http.get(`${API}/accounts/${NEW_ACCOUNT_ID}/sync/status`, () =>
		HttpResponse.json<SyncOperationsGetSyncStatusResponse>({
			accountId: NEW_ACCOUNT_ID,
			...sync,
		}),
	),
	http.post(`${API}/accounts/oauth/microsoft/start`, () =>
		HttpResponse.json<MicrosoftOAuthOperationsMicrosoftOAuthStartResponse>({
			authorizationUrl: "#microsoft-sign-in",
		}),
	),
];
