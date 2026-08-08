import { AlertTriangle, ArrowRight } from "lucide-react";

export interface ComposeSmtpMissingBannerProps {
	onConfigure: () => void;
}

/**
 * Non-dismissible banner shown above the compose form when the selected
 * account has no SMTP host configured. Pairs with a Send button that explains
 * rather than disables, so the user has a single, factual account of why
 * nothing will leave. See issue #196.
 */
export const ComposeSmtpMissingBanner = ({
	onConfigure,
}: ComposeSmtpMissingBannerProps) => (
	<div
		role="alert"
		data-testid="compose-smtp-missing-banner"
		className="flex items-start gap-3 border-b border-warning/50 bg-warning/10 px-3 py-2"
	>
		<AlertTriangle
			className="size-5 shrink-0 mt-0.5 text-warning"
			aria-hidden="true"
		/>
		<div className="flex-1 min-w-0">
			<p className="text-sm font-medium text-warning">
				This account can't send mail until SMTP is configured.
			</p>
			<button
				type="button"
				onClick={onConfigure}
				className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning hover:underline"
			>
				Configure SMTP
				<ArrowRight className="size-3" aria-hidden="true" />
			</button>
		</div>
	</div>
);
