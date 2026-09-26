import {
	type AccountService,
	type AccountServiceIntent,
	AccountServiceToggles,
	Banner,
} from "@remit/ui";
import { buildBugReportContext, buildGitHubIssueUrl } from "@/lib/bug-report";

export interface AccountServiceRefusal {
	service: AccountService;
	intent: AccountServiceIntent;
	message: string;
}

export interface AccountServicesCardProps {
	providerName: string;
	offered: AccountService[];
	enabled: AccountService[];
	refusal: AccountServiceRefusal | null;
	onRequestChange: (
		service: AccountService,
		intent: AccountServiceIntent,
	) => void;
}

const refusalTitle = (refusal: AccountServiceRefusal): string =>
	`Couldn't turn ${refusal.service.toLowerCase()} ${refusal.intent}`;

const reportHref = (refusal: AccountServiceRefusal): string =>
	buildGitHubIssueUrl(
		buildBugReportContext({
			title: `Bug: ${refusalTitle(refusal)}`,
			errorMessage: `${refusalTitle(refusal)} — ${refusal.message}`,
		}),
	);

export function AccountServicesCard({
	providerName,
	offered,
	enabled,
	refusal,
	onRequestChange,
}: AccountServicesCardProps) {
	if (offered.length < 2) return null;

	return (
		<section className="space-y-2 rounded-sm border border-line bg-surface px-row-inset py-3">
			<AccountServiceToggles
				providerName={providerName}
				offered={offered}
				enabled={enabled}
				consented={offered}
				onRequestChange={onRequestChange}
			/>
			{refusal && (
				<Banner tone="danger" variant="soft">
					<p className="font-medium">{refusalTitle(refusal)}</p>
					<p className="mt-0.5 break-words text-fg-muted">{refusal.message}</p>
					<a
						href={reportHref(refusal)}
						target="_blank"
						rel="noopener noreferrer"
						className="mt-1 inline-block font-medium text-accent hover:underline"
					>
						Report an issue
					</a>
				</Banner>
			)}
		</section>
	);
}
