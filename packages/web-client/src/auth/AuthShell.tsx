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

const cssVar = (name: string): string => `var(${name})`;

/* remit-ui semantic vars (tokens.css declares these on :root / .dark).
   We reference the raw vars — not the Tailwind `--color-*` aliases —
   because the `@theme inline` block inlines those into utilities rather
   than guaranteeing them as custom properties. */
const BRAND = cssVar("--accent");
const BRAND_HOVER = cssVar("--accent-hover");
const BRAND_SOFT = cssVar("--accent-soft");
const BRAND_FG = cssVar("--accent-fg");
const CARD_BG = cssVar("--surface");
const CARD_FG = cssVar("--fg");
const PAGE_BG = cssVar("--surface-sunken");
const MUTED_FG = cssVar("--fg-muted");
const BORDER = cssVar("--line");

const remitTheme = createTheme({
	name: "remit",
	tokens: {
		colors: {
			brand: {
				primary: {
					10: { value: BRAND_SOFT },
					20: { value: BRAND_SOFT },
					40: { value: BRAND },
					60: { value: BRAND },
					80: { value: BRAND },
					90: { value: BRAND },
					100: { value: BRAND },
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
				inverse: { value: BRAND_FG },
				hover: { value: BRAND },
				focus: { value: BRAND },
				active: { value: BRAND },
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
			/* Literal values from the remit-ui radius scale (2/3/5/7/10px).
			   Tailwind's `@theme inline` only emits theme variables that are
			   referenced from compiled CSS — var(--radius-*) lookups from
			   this JS theme object are invisible to its scanner, so they
			   would resolve to nothing at runtime. */
			small: { value: "3px" },
			medium: { value: "5px" },
			large: { value: "7px" },
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
					color: { value: BRAND_FG },
					_hover: {
						backgroundColor: { value: BRAND_HOVER },
						color: { value: BRAND_FG },
					},
					_focus: {
						backgroundColor: { value: BRAND },
						color: { value: BRAND_FG },
					},
					_active: {
						backgroundColor: { value: BRAND },
						color: { value: BRAND_FG },
					},
				},
				link: {
					color: { value: BRAND },
					_hover: {
						color: { value: BRAND },
						backgroundColor: { value: "transparent" },
					},
					_focus: {
						color: { value: BRAND },
						backgroundColor: { value: "transparent" },
					},
					_active: {
						color: { value: BRAND },
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
						color: { value: BRAND },
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
		stroke="currentColor"
		strokeWidth="1.75"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		style={{ color: BRAND }}
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
			remit,
		</Heading>
		<Text color={MUTED_FG} fontSize="0.875rem" marginTop="0.25rem">
			your email client in the cloud.
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
		className="fixed top-0 left-0 right-0 z-50 bg-warning/15 text-warning border-b border-warning/40 px-3 sm:px-4 text-xs sm:text-sm flex items-center gap-2 h-7 sm:h-10 overflow-hidden"
	>
		<strong className="font-semibold shrink-0">Local dev</strong>
		<span className="truncate hidden sm:inline">
			— Cognito not configured. Set VITE_COGNITO_USER_POOL_ID and
			VITE_COGNITO_CLIENT_ID in .env.local to enable sign-in.
		</span>
		<span className="truncate sm:hidden">— no Cognito; signed out</span>
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
				<div className="pt-7 sm:pt-10 h-dvh">{children}</div>
			</>
		);
	}

	return (
		<Authenticator.Provider>
			<SignInGate>{children}</SignInGate>
		</Authenticator.Provider>
	);
};
