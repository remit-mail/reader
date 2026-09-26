import { AccountService } from "@remit/domain-enums";

export type AccountServiceName =
	(typeof AccountService)[keyof typeof AccountService];

const GRAPH_RESOURCE = "https://graph.microsoft.com/";

const SESSION_SCOPES = ["offline_access", "openid", "email"];

const IDENTITY_SCOPES = new Set([...SESSION_SCOPES, "profile"]);

export const MICROSOFT_SERVICE_SCOPES: Readonly<
	Record<AccountServiceName, readonly string[]>
> = {
	[AccountService.Mail]: [
		"https://outlook.office.com/IMAP.AccessAsUser.All",
		"https://outlook.office.com/SMTP.Send",
	],
	[AccountService.Calendar]: [`${GRAPH_RESOURCE}Calendars.Read`],
};

export const orderServices = (
	services: readonly AccountServiceName[],
): AccountServiceName[] =>
	Object.values(AccountService).filter((service) => services.includes(service));

export const microsoftScopes = (
	services: readonly AccountServiceName[],
): string[] => [
	...orderServices(services).flatMap(
		(service) => MICROSOFT_SERVICE_SCOPES[service],
	),
	...SESSION_SCOPES,
];

export const normalizeMicrosoftScopes = (scope: string | undefined): string[] =>
	(scope ?? "")
		.split(" ")
		.filter((name) => name.length > 0 && !IDENTITY_SCOPES.has(name))
		.map((name) => (name.includes("://") ? name : `${GRAPH_RESOURCE}${name}`));

export const microsoftServicesGranted = (
	grantedScopes: readonly string[],
): AccountServiceName[] => {
	const granted = new Set(grantedScopes.map((scope) => scope.toLowerCase()));
	return Object.values(AccountService).filter((service) =>
		MICROSOFT_SERVICE_SCOPES[service].every((scope) =>
			granted.has(scope.toLowerCase()),
		),
	);
};
