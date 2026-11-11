import {
	type McpConnectedApp,
	McpConnectedAppsPage,
	McpConsentPage,
	McpDevicePage,
	type McpDeviceState,
	McpLoginPage,
	type McpPageError,
} from "@remit/ui/mcp-pages";
import { describeScopes } from "../auth/scopes.js";
import { renderPage } from "./render.js";

export interface ConnectedAppGrant {
	clientId: string;
	clientName: string;
	scopes: readonly string[];
	connectedAt: Date;
}

const connectedOn = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "long",
	timeZone: "UTC",
});

export const loginView = (
	hiddenFields: Readonly<Record<string, string>>,
	status = 200,
	email?: string,
	error?: McpPageError,
): Response =>
	renderPage(
		"Sign in to remit",
		<McpLoginPage hiddenFields={hiddenFields} email={email} error={error} />,
		status,
	);

export const consentView = (
	oauthQuery: string,
	clientName: string,
	scopes: readonly string[],
): Response =>
	renderPage(
		`Allow ${clientName}`,
		<McpConsentPage
			clientName={clientName}
			permissions={describeScopes(scopes)}
			oauthQuery={oauthQuery}
		/>,
	);

export const deviceView = (state: McpDeviceState, status = 200): Response =>
	renderPage("Connect a device", <McpDevicePage state={state} />, status);

export const connectedAppsView = (
	grants: readonly ConnectedAppGrant[],
	status = 200,
	disconnected?: string,
	error?: McpPageError,
): Response => {
	const apps: McpConnectedApp[] = grants.map((grant) => ({
		clientId: grant.clientId,
		name: grant.clientName,
		permissions: describeScopes(grant.scopes),
		connectedOn: connectedOn.format(grant.connectedAt),
	}));
	return renderPage(
		"Connected apps",
		<McpConnectedAppsPage
			apps={apps}
			disconnected={disconnected}
			error={error}
		/>,
		status,
	);
};
