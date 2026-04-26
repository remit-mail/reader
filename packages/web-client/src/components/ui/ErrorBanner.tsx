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
		container: "border-destructive/50 bg-destructive/10 dark:bg-destructive/20",
		icon: "text-destructive",
		title: "text-destructive",
	},
	warning: {
		container: "border-amber-500/50 bg-amber-500/10 dark:bg-amber-500/20",
		icon: "text-amber-600 dark:text-amber-400",
		title: "text-amber-700 dark:text-amber-300",
	},
	info: {
		container: "border-sky-500/50 bg-sky-500/10 dark:bg-sky-500/20",
		icon: "text-sky-600 dark:text-sky-400",
		title: "text-sky-700 dark:text-sky-300",
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
				"pointer-events-auto flex items-start gap-3 rounded-md border bg-background/80 px-3 py-2 shadow-md backdrop-blur",
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
					<p className="mt-0.5 text-xs text-muted-foreground break-words">
						{detail}
					</p>
				)}
			</div>
			<button
				type="button"
				onClick={() => onDismiss(id)}
				className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
				aria-label={`Dismiss ${SEVERITY_LABEL[severity].toLowerCase()}`}
			>
				<X className="size-4" aria-hidden="true" />
			</button>
		</div>
	);
};
