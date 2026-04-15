import { Amplify } from "aws-amplify";

export interface CognitoEnv {
	userPoolId: string;
	userPoolClientId: string;
	domain: string;
	region: string;
	appOrigin: string;
}

const readCognitoEnv = (): CognitoEnv | null => {
	const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
	const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
	const domain = import.meta.env.VITE_COGNITO_DOMAIN;
	const region = import.meta.env.VITE_COGNITO_REGION;
	const appOrigin = import.meta.env.VITE_APP_ORIGIN;

	if (!userPoolId || !userPoolClientId) return null;

	return {
		userPoolId,
		userPoolClientId,
		domain: domain ?? "",
		region: region ?? "",
		appOrigin: appOrigin ?? "",
	};
};

const cognitoEnv = readCognitoEnv();

export const isCognitoConfigured = (): boolean => cognitoEnv !== null;

export const configureAmplify = (): void => {
	if (!cognitoEnv) {
		console.warn(
			"[auth] VITE_COGNITO_USER_POOL_ID is not set. Running in local dev mode without Cognito auth.",
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
