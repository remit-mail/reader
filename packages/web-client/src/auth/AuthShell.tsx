import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import type { ReactNode } from "react";
import { isCognitoConfigured } from "./amplify-config";

interface AuthShellProps {
	children: ReactNode;
}

const LocalDevBanner = () => (
	<div
		role="alert"
		className="fixed top-0 left-0 right-0 z-50 bg-yellow-900/90 text-yellow-50 border-b border-yellow-700 px-4 py-2 text-sm"
	>
		<strong className="font-semibold">Cognito not configured</strong>
		<span className="ml-2">
			— local dev mode. Set VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID
			in .env.local to enable sign-in.
		</span>
	</div>
);

export const AuthShell = ({ children }: AuthShellProps) => {
	if (!isCognitoConfigured()) {
		return (
			<>
				<LocalDevBanner />
				<div className="pt-10 h-screen">{children}</div>
			</>
		);
	}

	return (
		<Authenticator hideSignUp={false}>
			{({ user }) => (user ? <>{children}</> : <></>)}
		</Authenticator>
	);
};
