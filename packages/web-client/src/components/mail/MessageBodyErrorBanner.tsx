import { AlertCircle, X } from "lucide-react";
import { useState } from "react";
import { useAuthProvider } from "@/auth/provider";
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
 * Inline alert banner for a body-fetch failure. Renders variant-specific copy
 * for auth-expired vs. body-missing-in-storage 403s (issue #401), with a
 * Retry button (always) and a Sign-in button (auth variant only, and only
 * when a session is active to sign out of). Dismissible — once dismissed, the
 * message body area falls back to an empty state until Retry is clicked.
 *
 * The sign-in affordance goes through the composed auth provider's `Account`
 * render-prop: it renders only when there is a session to sign out of, so no
 * identity SDK hook fires in a build (or a local-dev run) that has none.
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
	const { Account } = useAuthProvider();

	if (dismissed) return null;

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
				{reason === "auth" && (
					<Account>
						{({ signOut }) => (
							<button
								type="button"
								onClick={() => signOut()}
								className="text-sm font-medium text-accent hover:underline"
							>
								Sign in again
							</button>
						)}
					</Account>
				)}
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
