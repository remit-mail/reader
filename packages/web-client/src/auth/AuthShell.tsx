import {
	Authenticator,
	createTheme,
	Heading,
	Text,
	ThemeProvider,
	useTheme,
	View,
} from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import type { ReactNode } from "react";
import { isCognitoConfigured } from "./amplify-config";

interface AuthShellProps {
	children: ReactNode;
}

const REMIT_FONT =
	'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const remitTheme = createTheme({
	name: "remit",
	tokens: {
		colors: {
			brand: {
				primary: {
					10: { value: "hsl(222.2 47.4% 96%)" },
					20: { value: "hsl(222.2 47.4% 88%)" },
					40: { value: "hsl(222.2 47.4% 40%)" },
					60: { value: "hsl(222.2 47.4% 20%)" },
					80: { value: "hsl(222.2 47.4% 14%)" },
					90: { value: "hsl(222.2 47.4% 11.2%)" },
					100: { value: "hsl(222.2 47.4% 8%)" },
				},
			},
			background: {
				primary: { value: "hsl(0 0% 100%)" },
				secondary: { value: "hsl(210 40% 96.1%)" },
			},
			font: {
				primary: { value: "hsl(222.2 84% 4.9%)" },
				secondary: { value: "hsl(215.4 16.3% 46.9%)" },
				interactive: { value: "hsl(222.2 47.4% 11.2%)" },
			},
			border: {
				primary: { value: "hsl(214.3 31.8% 91.4%)" },
				secondary: { value: "hsl(214.3 31.8% 91.4%)" },
				focus: { value: "hsl(222.2 47.4% 11.2%)" },
			},
		},
		fonts: {
			default: {
				variable: { value: REMIT_FONT },
				static: { value: REMIT_FONT },
			},
		},
		radii: {
			small: { value: "0.25rem" },
			medium: { value: "0.5rem" },
			large: { value: "0.75rem" },
		},
		components: {
			authenticator: {
				router: {
					borderColor: { value: "hsl(214.3 31.8% 91.4%)" },
					boxShadow: {
						value:
							"0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px 0 rgb(0 0 0 / 0.04)",
					},
					backgroundColor: { value: "hsl(0 0% 100%)" },
				},
				form: {
					padding: { value: "1.5rem" },
				},
			},
			button: {
				primary: {
					backgroundColor: { value: "hsl(222.2 47.4% 11.2%)" },
					color: { value: "hsl(210 40% 98%)" },
					_hover: {
						backgroundColor: { value: "hsl(222.2 47.4% 20%)" },
						color: { value: "hsl(210 40% 98%)" },
					},
					_focus: {
						backgroundColor: { value: "hsl(222.2 47.4% 14%)" },
						color: { value: "hsl(210 40% 98%)" },
					},
					_active: {
						backgroundColor: { value: "hsl(222.2 47.4% 8%)" },
						color: { value: "hsl(210 40% 98%)" },
					},
				},
			},
			fieldcontrol: {
				borderColor: { value: "hsl(214.3 31.8% 91.4%)" },
				_focus: {
					borderColor: { value: "hsl(222.2 47.4% 11.2%)" },
					boxShadow: { value: "0 0 0 1px hsl(222.2 47.4% 11.2%)" },
				},
			},
			tabs: {
				item: {
					_active: {
						color: { value: "hsl(222.2 47.4% 11.2%)" },
						borderColor: { value: "hsl(222.2 47.4% 11.2%)" },
					},
					_hover: {
						color: { value: "hsl(222.2 47.4% 20%)" },
					},
				},
			},
		},
	},
});

const AuthHeader = () => {
	const { tokens } = useTheme();

	return (
		<View
			textAlign="center"
			padding={`${tokens.space.xl} 0 ${tokens.space.medium} 0`}
		>
			<Heading level={1} fontWeight="600" fontSize="2rem" color="font.primary">
				Remit
			</Heading>
			<Text color="font.secondary" fontSize="0.875rem" marginTop="0.25rem">
				Email as a service
			</Text>
		</View>
	);
};

const AuthFooter = () => {
	const { tokens } = useTheme();

	return (
		<View
			textAlign="center"
			padding={`${tokens.space.medium} 0 ${tokens.space.xl} 0`}
		>
			<Text color="font.secondary" fontSize="0.75rem">
				Secure sign-in powered by AWS Cognito
			</Text>
		</View>
	);
};

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
		<ThemeProvider theme={remitTheme}>
			<div className="min-h-screen w-full flex flex-col items-center justify-center bg-background px-4 py-8">
				<div className="w-full max-w-md">
					<Authenticator
						hideSignUp={false}
						components={{
							Header: AuthHeader,
							Footer: AuthFooter,
						}}
					>
						{({ user }) => (user ? <>{children}</> : <></>)}
					</Authenticator>
				</div>
			</div>
		</ThemeProvider>
	);
};
