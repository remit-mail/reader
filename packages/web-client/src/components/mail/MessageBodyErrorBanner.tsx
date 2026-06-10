import { useAuthenticator } from "@aws-amplify/ui-react";
import { AlertCircle, X } from "lucide-react";
import { useState } from "react";
import { isCognitoConfigured } from "@/auth/amplify-config";
import {
	contentForReason,
	extractFallbackDetail,
	extractReason,
} from "./message-body-error-banner-content";

interface MessageBodyErrorBannerProps {
	error: unknown;
	onRetry?: () => void;
}

/**
 * Sign-in button that pulls `signOut` from the Amplify Authenticator context.
 * Split into its own component so `useAuthenticator` is ONLY invoked when
 * Cognito is configured — i.e. when `AuthShell` actually mounted the
 * `Authenticator.Provider`. The hook throws `USE_AUTHENTICATOR_ERROR` when
 * called outside the Provider (see `@aws-amplify/ui-react-core` —
 * `useAuthenticator.ts` early-exits with `throw new Error(...)` if the
 * context is undefined), and React hooks can't be conditional, so the
 * conditional has to live one level up at the component-mount boundary.
 *
 * Signing out flips `AuthShell` back to the sign-in form; we don't ship a
 * standalone sign-in route — the Amplify Authenticator handles it.
 */
const SignInAgainButton = () => {
	const { signOut } = useAuthenticator((ctx) => [ctx.signOut]);
	return (
		<button
			type="button"
			onClick={() => signOut()}
			className="text-sm font-medium text-accent hover:underline"
		>
			Sign in again
		</button>
	);
};

/**
 * Inline alert banner for a body-fetch failure. Renders variant-specific copy
 * for auth-expired vs. body-missing-in-storage 403s (issue #401), with a
 * Retry button (always) and a Sign-in button (auth variant only, and only
 * when Cognito is configured — local-dev runs without the Authenticator
 * provider). Dismissible — once dismissed, the message body area falls back
 * to an empty state until Retry is clicked.
 *
 * Uses the same destructive colour palette as `ErrorState(variant="inline")`
 * so it looks at home in the message body slot.
 */
export const MessageBodyErrorBanner = ({
	error,
	onRetry,
}: MessageBodyErrorBannerProps) => {
	const reason = extractReason(error);
	const fallback = extractFallbackDetail(error);
	const { title, detail } = contentForReason(reason, fallback);
	const [dismissed, setDismissed] = useState(false);

	if (dismissed) return null;

	// Gate the `useAuthenticator`-using subcomponent on Cognito being
	// configured. In local-dev (`isCognitoConfigured() === false`),
	// `AuthShell` renders children without `Authenticator.Provider`, and
	// calling `useAuthenticator` would throw and crash this whole subtree —
	// the SPA has no error boundary above MessageBody.
	const showSignIn = reason === "auth" && isCognitoConfigured();

	return (
		<div
			role="alert"
			data-testid="message-body-error-banner"
			data-reason={reason}
			className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm"
		>
			<AlertCircle
				className="size-4 shrink-0 text-danger mt-0.5"
				aria-hidden="true"
			/>
			<div className="flex-1 min-w-0">
				<p className="font-medium text-danger">{title}</p>
				<p className="text-fg-muted mt-1 break-words">{detail}</p>
			</div>
			<div className="flex shrink-0 items-center gap-3">
				{showSignIn && <SignInAgainButton />}
				{onRetry && (
					<button
						type="button"
						onClick={onRetry}
						className="text-sm font-medium text-accent hover:underline"
					>
						Retry
					</button>
				)}
				<button
					type="button"
					onClick={() => setDismissed(true)}
					aria-label="Dismiss message body error"
					className="rounded-md p-1 text-fg-muted hover:bg-surface-raised hover:text-fg transition-colors"
				>
					<X className="size-4" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
};
