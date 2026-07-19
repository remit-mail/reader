import { configureAmplify } from "./amplify-config";
import { CognitoAccount } from "./cognito/CognitoAccount";
import { CognitoShell } from "./cognito/CognitoShell";
import {
	getCognitoToken,
	resetCognitoTokenCache,
} from "./cognito/cognito-token";
import type { AuthProvider } from "./provider";

/**
 * Cognito (AWS Amplify) identity. Importing this module is what pulls Amplify
 * into a build — a distributor that composes a different provider never
 * references it, so `aws-amplify` and `@aws-amplify/ui-react` stay out of that
 * bundle.
 */
export const cognitoAuthProvider: AuthProvider = {
	configure: configureAmplify,
	getToken: getCognitoToken,
	resetToken: resetCognitoTokenCache,
	Shell: CognitoShell,
	Account: CognitoAccount,
};
