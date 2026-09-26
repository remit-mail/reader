import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { AccountService } from "@remit/domain-enums";
import {
	createMailOAuthService,
	MICROSOFT_SERVICE_SCOPES,
	microsoftProviderConfig,
	microsoftScopes,
	microsoftServicesGranted,
	normalizeMicrosoftScopes,
} from "../index.js";

const IMAP = "https://outlook.office.com/IMAP.AccessAsUser.All";
const SMTP = "https://outlook.office.com/SMTP.Send";
const CALENDAR = "https://graph.microsoft.com/Calendars.Read";
const SESSION = ["offline_access", "openid", "email"];

describe("the Microsoft scopes a service selection asks for", () => {
	test("mail asks for IMAP and SMTP and never the calendar", () => {
		assert.deepEqual(microsoftScopes([AccountService.Mail]), [
			IMAP,
			SMTP,
			...SESSION,
		]);
	});

	test("calendar asks for the Graph calendar scope and no mailbox access", () => {
		assert.deepEqual(microsoftScopes([AccountService.Calendar]), [
			CALENDAR,
			...SESSION,
		]);
	});

	test("both put mail first whatever order they arrive in", () => {
		assert.deepEqual(
			microsoftScopes([
				AccountService.Calendar,
				AccountService.Mail,
				AccountService.Calendar,
			]),
			[IMAP, SMTP, CALENDAR, ...SESSION],
		);
	});

	test("a provider config with no selection asks for mail, as before", () => {
		const config = microsoftProviderConfig({
			clientId: "client-id",
			clientSecret: "client-secret",
		});

		assert.deepEqual(config.scopes, [IMAP, SMTP, ...SESSION]);
	});

	test("the authorization URL carries the scopes of the selection", () => {
		const service = createMailOAuthService(
			microsoftProviderConfig({
				clientId: "client-id",
				clientSecret: "client-secret",
				services: [AccountService.Calendar],
			}),
		);

		const url = new URL(
			service.buildAuthorizationUrl({
				redirectUri: "https://app.example.com/callback",
				state: "state",
			}),
		);

		assert.equal(
			url.searchParams.get("scope"),
			[CALENDAR, ...SESSION].join(" "),
		);
	});
});

describe("the scopes Microsoft reports as granted", () => {
	test("bare Graph names become full scope URIs and identity scopes drop out", () => {
		assert.deepEqual(
			normalizeMicrosoftScopes(
				"Calendars.Read openid profile email offline_access",
			),
			[CALENDAR],
		);
	});

	test("Outlook scopes keep their resource", () => {
		assert.deepEqual(normalizeMicrosoftScopes(`${IMAP} ${SMTP}`), [IMAP, SMTP]);
	});

	test("an absent scope field grants nothing", () => {
		assert.deepEqual(normalizeMicrosoftScopes(undefined), []);
	});

	test("a service counts as granted only when every one of its scopes is", () => {
		assert.deepEqual(microsoftServicesGranted([IMAP]), []);
		assert.deepEqual(microsoftServicesGranted([IMAP, SMTP]), [
			AccountService.Mail,
		]);
		assert.deepEqual(
			microsoftServicesGranted([
				CALENDAR.toLowerCase(),
				...MICROSOFT_SERVICE_SCOPES[AccountService.Mail],
			]),
			[AccountService.Mail, AccountService.Calendar],
		);
	});
});

describe("the code exchange", () => {
	let originalFetch: typeof globalThis.fetch;
	let sentScope: string | null;

	before(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			sentScope = new URLSearchParams(String(init?.body)).get("scope");
			return {
				ok: true,
				status: 200,
				json: async () => ({
					access_token: "access",
					expires_in: 3600,
					refresh_token: "refresh",
					scope: "Calendars.Read openid email",
				}),
			} as Response;
		}) as typeof globalThis.fetch;
	});

	after(() => {
		globalThis.fetch = originalFetch;
	});

	test("redeems the code for the selection's scopes and reports what was granted", async () => {
		const service = createMailOAuthService(
			microsoftProviderConfig({
				clientId: "client-id",
				clientSecret: "client-secret",
				services: [AccountService.Calendar],
				overrides: { tokenEndpoint: "https://example.com/token" },
			}),
		);

		const tokenSet = await service.exchangeCode(
			"code",
			"https://app.example.com/callback",
		);

		assert.equal(sentScope, [CALENDAR, ...SESSION].join(" "));
		assert.deepEqual(tokenSet.grantedScopes, [CALENDAR]);
	});
});
