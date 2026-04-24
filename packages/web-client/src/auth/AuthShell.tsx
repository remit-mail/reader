import {
	Authenticator,
	createTheme,
	Heading,
	Text,
	ThemeProvider,
	useAuthenticator,
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

const BRAND = "hsl(222.2 47.4% 11.2%)";
const BRAND_HOVER = "hsl(222.2 47.4% 20%)";
const BRAND_FOCUS = "hsl(222.2 47.4% 14%)";
const BRAND_ACTIVE = "hsl(222.2 47.4% 8%)";
const PAGE_BG = "hsl(210 40% 96.1%)";
const CARD_BG = "hsl(0 0% 100%)";
const CARD_FG = "hsl(222.2 84% 4.9%)";
const MUTED_FG = "hsl(215.4 16.3% 46.9%)";
const BORDER = "hsl(214.3 31.8% 91.4%)";
const WHITE = "hsl(210 40% 98%)";

const remitTheme = createTheme({
	name: "remit",
	tokens: {
		colors: {
			brand: {
				primary: {
					10: { value: "hsl(222.2 47.4% 96%)" },
					20: { value: "hsl(222.2 47.4% 88%)" },
					40: { value: "hsl(222.2 47.4% 40%)" },
					60: { value: BRAND_HOVER },
					80: { value: BRAND_FOCUS },
					90: { value: BRAND },
					100: { value: BRAND_ACTIVE },
				},
			},
			background: {
				primary: { value: CARD_BG },
				secondary: { value: PAGE_BG },
			},
			font: {
				primary: { value: CARD_FG },
				secondary: { value: MUTED_FG },
				tertiary: { value: MUTED_FG },
				interactive: { value: BRAND },
				inverse: { value: WHITE },
				hover: { value: BRAND_HOVER },
				focus: { value: BRAND },
				active: { value: BRAND_ACTIVE },
			},
			border: {
				primary: { value: BORDER },
				secondary: { value: BORDER },
				focus: { value: BRAND },
			},
		},
		fonts: {
			default: {
				variable: { value: REMIT_FONT },
				static: { value: REMIT_FONT },
			},
		},
		radii: {
			small: { value: "0.375rem" },
			medium: { value: "0.5rem" },
			large: { value: "0.75rem" },
		},
		components: {
			authenticator: {
				router: {
					borderColor: { value: BORDER },
					borderWidth: { value: "1px" },
					boxShadow: {
						value:
							"0 10px 30px -10px rgb(15 23 42 / 0.18), 0 4px 12px -6px rgb(15 23 42 / 0.1)",
					},
					backgroundColor: { value: CARD_BG },
				},
				form: {
					padding: { value: "1.75rem" },
				},
				orContainer: {
					color: { value: MUTED_FG },
				},
			},
			button: {
				color: { value: CARD_FG },
				primary: {
					backgroundColor: { value: BRAND },
					color: { value: WHITE },
					_hover: {
						backgroundColor: { value: BRAND_HOVER },
						color: { value: WHITE },
					},
					_focus: {
						backgroundColor: { value: BRAND_FOCUS },
						color: { value: WHITE },
					},
					_active: {
						backgroundColor: { value: BRAND_ACTIVE },
						color: { value: WHITE },
					},
				},
				link: {
					color: { value: BRAND },
					_hover: {
						color: { value: BRAND_HOVER },
						backgroundColor: { value: "transparent" },
					},
					_focus: {
						color: { value: BRAND_FOCUS },
						backgroundColor: { value: "transparent" },
					},
					_active: {
						color: { value: BRAND_ACTIVE },
						backgroundColor: { value: "transparent" },
					},
				},
			},
			fieldcontrol: {
				color: { value: CARD_FG },
				borderColor: { value: BORDER },
				_focus: {
					borderColor: { value: BRAND },
					boxShadow: { value: `0 0 0 2px ${BRAND}` },
				},
			},
			field: {
				label: {
					color: { value: CARD_FG },
				},
			},
			tabs: {
				borderColor: { value: BORDER },
				item: {
					color: { value: MUTED_FG },
					backgroundColor: { value: "transparent" },
					_active: {
						color: { value: BRAND },
						borderColor: { value: BRAND },
						backgroundColor: { value: "transparent" },
					},
					_hover: {
						color: { value: BRAND_HOVER },
					},
					_focus: {
						color: { value: BRAND },
					},
				},
			},
			heading: {
				color: { value: CARD_FG },
			},
			text: {
				color: { value: CARD_FG },
			},
		},
	},
});

const EnvelopeMark = () => (
	<svg
		width="36"
		height="36"
		viewBox="0 0 24 24"
		fill="none"
		stroke={BRAND}
		strokeWidth="1.75"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<rect x="3" y="5" width="18" height="14" rx="2" />
		<path d="M3 7l9 6 9-6" />
	</svg>
);

const AuthHeader = () => (
	<View textAlign="center" padding="0 0 1.5rem 0">
		<View
			padding="0 0 0.75rem 0"
			style={{
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
			}}
		>
			<EnvelopeMark />
		</View>
		<Heading
			level={1}
			fontWeight="600"
			fontSize="1.75rem"
			color={CARD_FG}
			style={{ letterSpacing: "-0.01em" }}
		>
			Remit
		</Heading>
		<Text color={MUTED_FG} fontSize="0.875rem" marginTop="0.25rem">
			Email as a service
		</Text>
	</View>
);

const AuthFooter = () => (
	<View textAlign="center" padding="1.25rem 0 0 0">
		<Text color={MUTED_FG} fontSize="0.75rem">
			Secure sign-in powered by AWS Cognito
		</Text>
	</View>
);

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

const SignInGate = ({ children }: { children: ReactNode }) => {
	const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);

	if (authStatus === "authenticated") {
		return <>{children}</>;
	}

	return (
		<ThemeProvider theme={remitTheme}>
			<div data-auth-page className="auth-page">
				<div className="auth-page-inner">
					<Authenticator
						hideSignUp={false}
						components={{
							Header: AuthHeader,
							Footer: AuthFooter,
						}}
					/>
				</div>
			</div>
		</ThemeProvider>
	);
};

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
		<Authenticator.Provider>
			<SignInGate>{children}</SignInGate>
		</Authenticator.Provider>
	);
};
