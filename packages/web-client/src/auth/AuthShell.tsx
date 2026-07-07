import {
	Authenticator,
	createTheme,
	ThemeProvider,
	useAuthenticator,
} from "@aws-amplify/ui-react";
import { AuthCard, AuthFooter, AuthHero, Banner } from "@remit/ui";
import type { ReactNode } from "react";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";
import { authFooterNote } from "./account-menu-mode";
import { isCognitoConfigured } from "./amplify-config";
import { BetterAuthShell } from "./BetterAuthShell";
import { isBetterAuthEnabled } from "./better-auth-config";

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

// Amplify's default placeholders are title-case ("Enter your Username"); the
// design + app copy convention is lowercase (#883).
const authFormFields = {
	signIn: {
		username: { placeholder: "Enter your username" },
		password: { placeholder: "Enter your password" },
	},
	signUp: {
		username: { placeholder: "Enter your username" },
		password: { placeholder: "Enter your password" },
		confirm_password: { placeholder: "Confirm your password" },
	},
};

const LocalDevBanner = () => (
	<Banner
		tone="warning"
		className="fixed top-0 left-0 right-0 z-50 h-7 sm:h-10 overflow-hidden border-x-0 border-t-0"
	>
		<span className="flex items-center gap-2">
			<strong className="font-semibold shrink-0">Local dev</strong>
			<span className="truncate hidden sm:inline">
				— Cognito not configured. Set VITE_COGNITO_USER_POOL_ID and
				VITE_COGNITO_CLIENT_ID in .env.local to enable sign-in.
			</span>
			<span className="truncate sm:hidden">— no Cognito; signed out</span>
		</span>
	</Banner>
);

const CognitoAuthFooter = () => (
	<AuthFooter
		note={authFooterNote({
			betterAuthEnabled: isBetterAuthEnabled(),
			cognitoConfigured: isCognitoConfigured(),
		})}
	/>
);

const SignInGate = ({ children }: { children: ReactNode }) => {
	const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);

	if (authStatus === "authenticated") {
		return <>{children}</>;
	}

	// While Amplify hydrates a stored session, render the app-shell skeleton
	// instead of flashing the sign-in form (or a blank screen) — most returning
	// users resolve to `authenticated` and never see the form.
	if (authStatus === "configuring") {
		return <AppShellSkeleton />;
	}

	return (
		<ThemeProvider theme={remitTheme}>
			<AuthCard>
				<AuthHero />
				<Authenticator
					hideSignUp={false}
					formFields={authFormFields}
					components={{ Footer: CognitoAuthFooter }}
				/>
			</AuthCard>
		</ThemeProvider>
	);
};

export const AuthShell = ({ children }: AuthShellProps) => {
	// Postgres-parity mode: better-auth owns identity. Gated behind an explicit
	// flag so the Cognito path and the no-auth e2e bypass are unaffected.
	if (isBetterAuthEnabled()) {
		return <BetterAuthShell>{children}</BetterAuthShell>;
	}

	if (!isCognitoConfigured()) {
		// The dev banner is fixed at the top. Pad content below it AND shrink the
		// inner `main` (hardcoded `h-dvh`) by the banner height — otherwise main's
		// full 100dvh starts below the 40px padding and overflows, pushing pinned
		// footers like the compose Send bar 40px below the fold (#788).
		return (
			<div className="pt-7 sm:pt-10 [&_#main-content]:h-[calc(100dvh-1.75rem)] sm:[&_#main-content]:h-[calc(100dvh-2.5rem)]">
				<LocalDevBanner />
				{children}
			</div>
		);
	}

	return (
		<Authenticator.Provider>
			<SignInGate>{children}</SignInGate>
		</Authenticator.Provider>
	);
};
