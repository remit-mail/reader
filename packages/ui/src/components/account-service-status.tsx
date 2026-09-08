import { PauseCircle } from "lucide-react";
import { cn } from "../lib/cn.js";
import type { AccountService } from "./account-service-choice.js";
import { Badge } from "./badge.js";
import { Banner } from "./banner.js";

/**
 * How every surface names a service an account has switched off. One wording,
 * so an account list, a picker and the sidebar say the same thing about the
 * same account.
 */
export const ACCOUNT_SERVICE_OFF_LABEL: Record<AccountService, string> = {
	Mail: "mail sync off",
	Calendar: "calendar sync off",
};

/**
 * What the stored rows are, said where they are read. Disabling deletes
 * nothing, so the surface holding the rows says what it is holding rather than
 * reading as a broken account or an empty mailbox.
 */
export const ACCOUNT_SERVICE_OFF_MESSAGE: Record<AccountService, string> = {
	Mail: "Mail sync is off for this account. Everything already synced is here to read; nothing new arrives until you turn mail back on.",
	Calendar:
		"Calendar sync is off for this account. Its events stay on your calendar; nothing new arrives until you turn calendar back on.",
};

export interface AccountServiceOffBadgeProps {
	service: AccountService;
	className?: string;
}

/**
 * The label an account carries wherever it is listed while a service is off. It
 * is a label and never a removal: the account keeps its place in the list, the
 * picker and the sidebar (#1179).
 */
export function AccountServiceOffBadge({
	service,
	className,
}: AccountServiceOffBadgeProps) {
	return (
		<Badge tone="neutral" className={className}>
			<PauseCircle className="size-3 shrink-0" aria-hidden />
			{ACCOUNT_SERVICE_OFF_LABEL[service]}
		</Badge>
	);
}

export interface AccountServiceOffNoticeProps {
	service: AccountService;
	/** The way back on. Absent leaves the notice a statement. */
	onEnable?: () => void;
	className?: string;
}

/**
 * The notice above stored rows a switched-off service left behind — a mailbox
 * opened directly, or a provider calendar still drawn on the grid. It states
 * what stayed and what stopped, and offers the switch that resumes it.
 */
export function AccountServiceOffNotice({
	service,
	onEnable,
	className,
}: AccountServiceOffNoticeProps) {
	return (
		<Banner tone="info" variant="soft" className={cn("text-xs", className)}>
			<span>{ACCOUNT_SERVICE_OFF_MESSAGE[service]}</span>
			{onEnable && (
				<button
					type="button"
					onClick={onEnable}
					className="ml-1 font-medium text-accent underline"
				>
					{service === "Mail" ? "Turn mail back on" : "Turn calendar back on"}
				</button>
			)}
		</Banner>
	);
}
