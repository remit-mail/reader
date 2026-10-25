import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import type { MsOAuthCredentials } from "./msoauth.js";

const MsOAuthSecret = z.object({
	clientId: z.string().min(1),
	clientSecret: z.string().min(1),
});

let client: SecretsManagerClient | null = null;

const secretsManager = (): SecretsManagerClient => {
	if (!client) client = new SecretsManagerClient({});
	return client;
};

const parseSecret = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
};

export const msOAuthCredentialsFromSecret =
	(secretArn: string) => async (): Promise<MsOAuthCredentials> => {
		const result = await secretsManager().send(
			new GetSecretValueCommand({ SecretId: secretArn }),
		);
		const parsed = MsOAuthSecret.safeParse(
			parseSecret(result.SecretString ?? ""),
		);
		if (!parsed.success) {
			throw new Error(
				"The Microsoft OAuth secret named by MSOAUTH_SECRET_ARN does not hold a JSON object with a non-empty clientId and clientSecret",
			);
		}
		return parsed.data;
	};
