import {
	APP_BUILD_TIME,
	APP_SHORT_SHA,
	GITHUB_COMMIT_URL,
} from "@/lib/app-info";

export interface AppVersionProps {
	/** Override SHA for testing/Storybook. Defaults to the build-time constant. */
	sha?: string;
	/** Override commit URL. Defaults to the GitHub commit link. */
	commitUrl?: string;
	/** Override build time ISO string. Defaults to the build-time constant. */
	buildTime?: string;
}

function formatBuildTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

export function AppVersion({
	sha = APP_SHORT_SHA,
	commitUrl = GITHUB_COMMIT_URL,
	buildTime = APP_BUILD_TIME,
}: AppVersionProps) {
	return (
		<p className="text-xs text-fg-subtle">
			Version{" "}
			<a
				href={commitUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="font-mono hover:text-fg-muted hover:underline"
			>
				{sha}
			</a>
			{" · "}
			<span>Built {formatBuildTime(buildTime)}</span>
		</p>
	);
}
