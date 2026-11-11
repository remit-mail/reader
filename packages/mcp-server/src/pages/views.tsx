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
import { errorPage, renderPage } from "./render.js";

export interface ConnectedAppGrant {
	clientId: string;
	clientName: string;
	scopes: readonly string[];
	connectedAt: Date;
}

export interface PageViews {
	errorPage: (
		heading: string,
		message: string,
		fix: string,
		status: number,
	) => Response;
	loginView: (
		hiddenFields: Readonly<Record<string, string>>,
		status?: number,
		email?: string,
		error?: McpPageError,
	) => Response;
	consentView: (
		oauthQuery: string,
		clientName: string,
		scopes: readonly string[],
	) => Response;
	deviceView: (state: McpDeviceState, status?: number) => Response;
	connectedAppsView: (
		grants: readonly ConnectedAppGrant[],
		status?: number,
		disconnected?: string,
		error?: McpPageError,
	) => Response;
}

const connectedOn = new Intl.DateTimeFormat("en-GB", {
	dateStyle: "long",
	timeZone: "UTC",
});

export const createPageViews = (stylesheetHref: string): PageViews => ({
	errorPage: (heading, message, fix, status) =>
		errorPage(stylesheetHref, heading, message, fix, status),
	loginView: (hiddenFields, status = 200, email, error) =>
		renderPage(
			stylesheetHref,
			"Sign in to remit",
			<McpLoginPage hiddenFields={hiddenFields} email={email} error={error} />,
			status,
		),
	consentView: (oauthQuery, clientName, scopes) =>
		renderPage(
			stylesheetHref,
			`Allow ${clientName}`,
			<McpConsentPage
				clientName={clientName}
				permissions={describeScopes(scopes)}
				oauthQuery={oauthQuery}
			/>,
		),
	deviceView: (state, status = 200) =>
		renderPage(
			stylesheetHref,
			"Connect a device",
			<McpDevicePage state={state} />,
			status,
		),
	connectedAppsView: (grants, status = 200, disconnected, error) => {
		const apps: McpConnectedApp[] = grants.map((grant) => ({
			clientId: grant.clientId,
			name: grant.clientName,
			permissions: describeScopes(grant.scopes),
			connectedOn: connectedOn.format(grant.connectedAt),
		}));
		return renderPage(
			stylesheetHref,
			"Connected apps",
			<McpConnectedAppsPage
				apps={apps}
				disconnected={disconnected}
				error={error}
			/>,
			status,
		);
	},
});
