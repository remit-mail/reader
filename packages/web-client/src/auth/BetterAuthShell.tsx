import {
	AuthCard,
	AuthFooter,
	AuthHero,
	Banner,
	Button,
	Input,
} from "@remit/ui";
import { type FormEvent, type ReactNode, useState } from "react";
import { AppShellSkeleton } from "@/components/layout/AppShellSkeleton";
import { FatalErrorOverlay } from "@/components/ui/FatalErrorOverlay";
import { authFooterNote } from "./account-menu-mode";
import {
	type AuthRequest,
	authInlineMessage,
	classifyAuthError,
	reportFatalAuthError,
} from "./auth-error";
import {
	authClient,
	isBetterAuthEnabled,
	isSignUpDisabledError,
} from "./better-auth-config";

type Mode = "signIn" | "signUp";

interface BetterAuthShellProps {
	children: ReactNode;
}

const SIGN_UP_REQUEST: AuthRequest = {
	method: "POST",
	path: "/api/auth/sign-up/email",
};
const SIGN_IN_REQUEST: AuthRequest = {
	method: "POST",
	path: "/api/auth/sign-in/email",
};

export const SignInForm = () => {
	const [mode, setMode] = useState<Mode>("signIn");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	// Learned from the server's rejection, never a client-side flag — the UI
	// cannot disagree with better-auth's `disableSignUp`.
	const [signUpClosed, setSignUpClosed] = useState(false);

	const activeMode: Mode = signUpClosed ? "signIn" : mode;

	const handleFailure = (failure: unknown, request: AuthRequest) => {
		if (isSignUpDisabledError(failure)) {
			setSignUpClosed(true);
			setMode("signIn");
			return;
		}
		const kind = classifyAuthError(failure);
		if (kind === "fatal") {
			reportFatalAuthError(failure, request);
			return;
		}
		setError(authInlineMessage(failure, kind));
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (submitting) return;
		setError(null);
		setSubmitting(true);

		const request = activeMode === "signUp" ? SIGN_UP_REQUEST : SIGN_IN_REQUEST;
		// better-auth returns `{ error }` for a server rejection, but a network
		// failure rejects the promise — fold both into one failure value so a
		// broken route or contract never vanishes as an unhandled rejection.
		const failure: unknown = await (activeMode === "signUp"
			? authClient.signUp.email({ email, password, name })
			: authClient.signIn.email({ email, password })
		).then(
			(result) => result.error ?? null,
			(thrown: unknown) => thrown,
		);

		setSubmitting(false);
		// On success `failure` is null; better-auth's session store updates and
		// useSession re-renders the gate into the app.
		if (failure) handleFailure(failure, request);
	};

	return (
		<>
			<FatalErrorOverlay />
			<AuthCard>
				<AuthHero />
				<form
					onSubmit={submit}
					className="mt-6 flex flex-col gap-4 rounded-lg border border-line bg-surface p-7 shadow-lg"
				>
					{signUpClosed ? (
						<Banner tone="info">
							New signups are currently closed. Sign in with an existing
							account, or contact your administrator for access.
						</Banner>
					) : (
						<div className="flex gap-1">
							<Button
								size="sm"
								variant={activeMode === "signIn" ? "secondary" : "ghost"}
								aria-pressed={activeMode === "signIn"}
								onClick={() => setMode("signIn")}
							>
								Sign in
							</Button>
							<Button
								size="sm"
								variant={activeMode === "signUp" ? "secondary" : "ghost"}
								aria-pressed={activeMode === "signUp"}
								onClick={() => setMode("signUp")}
							>
								Create account
							</Button>
						</div>
					)}

					{error && <Banner tone="danger">{error}</Banner>}

					{activeMode === "signUp" && (
						<div className="flex flex-col gap-1 text-sm">
							<label htmlFor="ba-name" className="text-fg-muted">
								Name
							</label>
							<Input
								id="ba-name"
								type="text"
								autoComplete="name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Your name"
								required
							/>
						</div>
					)}

					<div className="flex flex-col gap-1 text-sm">
						<label htmlFor="ba-email" className="text-fg-muted">
							Email
						</label>
						<Input
							id="ba-email"
							type="email"
							autoComplete="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="you@example.com"
							required
						/>
					</div>

					<div className="flex flex-col gap-1 text-sm">
						<label htmlFor="ba-password" className="text-fg-muted">
							Password
						</label>
						<Input
							id="ba-password"
							type="password"
							autoComplete={
								activeMode === "signUp" ? "new-password" : "current-password"
							}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="Your password"
							required
						/>
					</div>

					<Button type="submit">
						{activeMode === "signUp" ? "Create account" : "Sign in"}
					</Button>
				</form>
				<AuthFooter
					note={authFooterNote({
						betterAuthEnabled: isBetterAuthEnabled(),
						cognitoConfigured: false,
					})}
				/>
			</AuthCard>
		</>
	);
};

export const BetterAuthShell = ({ children }: BetterAuthShellProps) => {
	const { data: session, isPending } = authClient.useSession();

	if (isPending) return <AppShellSkeleton />;
	if (session) return <>{children}</>;
	return <SignInForm />;
};
