import { AuthCard, AuthHero, Banner, Button } from "@remit/ui";

export interface SessionRateLimitedProps {
	onRetry: () => void;
	onReport: () => void;
}

/**
 * The session could not be checked because the server is throttling this
 * address. Shown instead of the sign-in screen, which would claim a sign-out
 * that never happened (#441). The limits are keyed by IP, so a household, an
 * office, a VPN exit or a handful of open tabs all spend one budget — the copy
 * says so, because otherwise a single user cannot explain what they did wrong.
 */
export const SessionRateLimited = ({
	onRetry,
	onReport,
}: SessionRateLimitedProps) => (
	<AuthCard>
		<AuthHero />
		<div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-7 shadow-lg">
			<Banner tone="warning">
				<p className="font-medium">Too many requests from this address</p>
				<p className="mt-1">
					The server is limiting requests from your network address, so it could
					not check whether you are signed in. You have not been signed out.
				</p>
			</Banner>
			<p className="text-sm text-fg-muted">
				Wait a minute and try again. Everyone behind the same address — other
				people on this network, and every tab you have open — shares one limit.
			</p>
			<Button onClick={onRetry}>Try again</Button>
			<Button variant="ghost" size="sm" onClick={onReport}>
				Report an issue
			</Button>
		</div>
	</AuthCard>
);
