import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ErrorBannerSeverity } from "./error-banners.js";

interface ErrorBannerProps {
	id: string;
	severity: ErrorBannerSeverity;
	title: string;
	detail?: string;
	onDismiss: (id: string) => void;
}

const SEVERITY_STYLES: Record<
	ErrorBannerSeverity,
	{ container: string; icon: string; title: string }
> = {
	error: {
		container: "border-danger/50 bg-danger-soft",
		icon: "text-danger",
		title: "text-danger",
	},
	warning: {
		container: "border-warning/50 bg-warning-soft",
		icon: "text-warning",
		title: "text-warning",
	},
	info: {
		container: "border-accent-2/50 bg-accent-2-soft",
		icon: "text-accent-2",
		title: "text-accent-2",
	},
};

const SEVERITY_ICONS: Record<
	ErrorBannerSeverity,
	typeof AlertCircle | typeof AlertTriangle | typeof Info
> = {
	error: AlertCircle,
	warning: AlertTriangle,
	info: Info,
};

const SEVERITY_LABEL: Record<ErrorBannerSeverity, string> = {
	error: "Error",
	warning: "Warning",
	info: "Information",
};

export const ErrorBanner = ({
	id,
	severity,
	title,
	detail,
	onDismiss,
}: ErrorBannerProps) => {
	const styles = SEVERITY_STYLES[severity];
	const Icon = SEVERITY_ICONS[severity];

	return (
		<div
			role={severity === "error" ? "alert" : "status"}
			aria-live={severity === "error" ? "assertive" : "polite"}
			className={cn(
				// Opaque, not translucent: a banner overlaps the toolbar and the
				// message list, and see-through text on top of see-through text is
				// unreadable (issue #55).
				"pointer-events-auto flex items-start gap-3 rounded-md border bg-canvas px-3 py-2 shadow-lg",
				styles.container,
			)}
		>
			<Icon
				className={cn("size-5 shrink-0 mt-0.5", styles.icon)}
				aria-hidden="true"
			/>
			<div className="flex-1 min-w-0">
				<p className={cn("text-sm font-medium", styles.title)}>{title}</p>
				{detail && (
					<p className="mt-0.5 text-xs text-fg-muted break-words">{detail}</p>
				)}
			</div>
			<button
				type="button"
				onClick={() => onDismiss(id)}
				className="shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-raised hover:text-fg transition-colors"
				aria-label={`Dismiss ${SEVERITY_LABEL[severity].toLowerCase()}`}
			>
				<X className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
};
