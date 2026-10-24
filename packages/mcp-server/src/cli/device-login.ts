import { DEVICE_CODE_GRANT_TYPE } from "@better-auth/oauth-provider";
import { z } from "zod";
import { MCP_SCOPES } from "../auth/scopes.js";

export interface DeviceLoginIo {
	fetch: typeof fetch;
	print: (line: string) => void;
	sleep: (ms: number) => Promise<void>;
}

export type DeviceLoginResult =
	| { ok: true; accessToken: string; command: string }
	| { ok: false; error: string; description: string };

const CLIENT_NAME = "remit mcp login";
const SLOW_DOWN_STEP_SECONDS = 5;

const metadataSchema = z.object({
	registration_endpoint: z.string(),
	device_authorization_endpoint: z.string(),
	token_endpoint: z.string(),
});

const registrationSchema = z.object({ client_id: z.string() });

const deviceAuthorizationSchema = z.object({
	device_code: z.string(),
	user_code: z.string(),
	verification_uri: z.string(),
	verification_uri_complete: z.string(),
	expires_in: z.number(),
	interval: z.number(),
});

const tokenSchema = z.object({ access_token: z.string() });

const errorSchema = z.object({
	error: z.string(),
	error_description: z.string().default(""),
});

type Step<T> =
	| { ok: true; value: T }
	| { ok: false; error: string; description: string };

const read = async <T>(
	response: Response,
	schema: z.ZodType<T>,
	step: string,
): Promise<Step<T>> => {
	const body: unknown = await response.json();
	if (response.ok) {
		const parsed = schema.safeParse(body);
		if (parsed.success) return { ok: true, value: parsed.data };
		return {
			ok: false,
			error: "invalid_response",
			description: `${step} answered with an unexpected body`,
		};
	}
	const failure = errorSchema.safeParse(body);
	return failure.success
		? {
				ok: false,
				error: failure.data.error,
				description: failure.data.error_description,
			}
		: {
				ok: false,
				error: "http_error",
				description: `${step} answered ${response.status}`,
			};
};

export const claudeMcpAddCommand = (
	origin: string,
	accessToken: string,
): string =>
	`claude mcp add --transport http --header "Authorization: Bearer ${accessToken}" remit ${origin}/mcp`;

export const deviceLogin = async (
	origin: string,
	io: DeviceLoginIo,
): Promise<DeviceLoginResult> => {
	const metadata = await read(
		await io.fetch(`${origin}/.well-known/oauth-authorization-server`),
		metadataSchema,
		"The authorization server metadata",
	);
	if (!metadata.ok) return metadata;

	const registration = await read(
		await io.fetch(metadata.value.registration_endpoint, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				client_name: CLIENT_NAME,
				grant_types: [DEVICE_CODE_GRANT_TYPE],
				token_endpoint_auth_method: "none",
			}),
		}),
		registrationSchema,
		"Client registration",
	);
	if (!registration.ok) return registration;
	const clientId = registration.value.client_id;
	const resource = `${origin}/mcp`;

	const authorization = await read(
		await io.fetch(metadata.value.device_authorization_endpoint, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				scope: MCP_SCOPES.join(" "),
				resource,
			}),
		}),
		deviceAuthorizationSchema,
		"The device authorization request",
	);
	if (!authorization.ok) return authorization;
	const grant = authorization.value;

	io.print(
		`Open ${grant.verification_uri} and enter the code ${grant.user_code}`,
	);
	io.print(`or go straight to ${grant.verification_uri_complete}`);
	io.print(`The code expires in ${Math.round(grant.expires_in / 60)} minutes.`);

	let intervalSeconds = grant.interval;
	for (;;) {
		await io.sleep(intervalSeconds * 1000);
		const polled = await read(
			await io.fetch(metadata.value.token_endpoint, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: DEVICE_CODE_GRANT_TYPE,
					device_code: grant.device_code,
					client_id: clientId,
					resource,
				}),
			}),
			tokenSchema,
			"The token endpoint",
		);
		if (polled.ok) {
			return {
				ok: true,
				accessToken: polled.value.access_token,
				command: claudeMcpAddCommand(origin, polled.value.access_token),
			};
		}
		if (polled.error === "authorization_pending") continue;
		if (polled.error === "slow_down") {
			intervalSeconds += SLOW_DOWN_STEP_SECONDS;
			continue;
		}
		return polled;
	}
};
