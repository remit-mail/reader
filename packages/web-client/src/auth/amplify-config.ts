import { Amplify } from "aws-amplify";
import { getRuntimeConfig } from "../runtime-config";

export interface CognitoEnv {
	userPoolId: string;
	userPoolClientId: string;
	domain: string;
	region: string;
	appOrigin: string;
}

const readCognitoEnv = (): CognitoEnv | null => {
	const config = getRuntimeConfig();
	const { userPoolId, clientId, domain, region } = config.cognito;

	if (!userPoolId || !clientId) return null;

	return {
		userPoolId,
		userPoolClientId: clientId,
		domain,
		region,
		appOrigin: config.appOrigin,
	};
};

const cognitoEnv = readCognitoEnv();

export const isCognitoConfigured = (): boolean => cognitoEnv !== null;

export const configureAmplify = (): void => {
	if (!cognitoEnv) {
		console.warn(
			"[auth] Cognito user pool is not configured. Running in local dev mode without Cognito auth.",
		);
		return;
	}

	const { userPoolId, userPoolClientId, domain, appOrigin } = cognitoEnv;

	Amplify.configure({
		Auth: {
			Cognito: {
				userPoolId,
				userPoolClientId,
				loginWith: domain
					? {
							oauth: {
								domain,
								scopes: ["openid", "email", "profile"],
								redirectSignIn: appOrigin ? [appOrigin] : [],
								redirectSignOut: appOrigin ? [appOrigin] : [],
								responseType: "code",
							},
						}
					: undefined,
			},
		},
	});
};
