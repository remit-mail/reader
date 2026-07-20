/**
 * Self-update state for a Remit you run yourself.
 *
 * The server is the thing being replaced, so the UI cannot assume it stays
 * reachable across the operation. Every state here is one the client can be
 * left holding on its own, and each names what the user can do next.
 */

export interface ReleaseInfo {
	version: string;
	releasedAt: number;
	releaseNotesUrl: string;
	/** One line of plain language, not a changelog dump. */
	summary: string;
}

/** Where the operation is between consent and a reachable server again. */
export type UpdatePhase = "preparing" | "restarting" | "reconnecting";

export type SelfUpdateState =
	| { status: "upToDate"; version: string; checkedAt: number }
	| { status: "checking"; version: string }
	| {
			status: "checkFailed";
			version: string;
			/** Plain-language cause, e.g. "no route to github.com". */
			reason: string;
			lastCheckedAt?: number;
	  }
	| { status: "available"; version: string; release: ReleaseInfo }
	| {
			status: "applying";
			version: string;
			target: string;
			phase: UpdatePhase;
			/** Seconds since the user consented, for honest "still working" copy. */
			elapsedSeconds: number;
	  }
	| {
			status: "succeeded";
			version: string;
			previousVersion: string;
			releaseNotesUrl: string;
	  }
	| {
			status: "rolledBack";
			/** The version running now — the old one, restored. */
			version: string;
			attemptedVersion: string;
			reason: string;
			logsCommand: string;
	  }
	| {
			status: "unreachable";
			previousVersion: string;
			attemptedVersion: string;
			elapsedSeconds: number;
			logsCommand: string;
	  };

export type SelfUpdateStatus = SelfUpdateState["status"];

const phaseLabels: Record<UpdatePhase, string> = {
	preparing: "Getting the new version ready",
	restarting: "Restarting Remit",
	reconnecting: "Waiting for Remit to answer again",
};

export function updatePhaseLabel(phase: UpdatePhase): string {
	return phaseLabels[phase];
}

/**
 * The restart takes the server away, so silence is expected for a while. Say
 * so before the wait feels like a hang, and stop promising once it does.
 */
export function updateWaitNote(elapsedSeconds: number): string {
	if (elapsedSeconds < 90) return "This usually takes about a minute.";
	if (elapsedSeconds < 240)
		return "Longer than usual. Remit is still trying to reach the server.";
	return "Still no answer. Your old version is kept, so there is a way back.";
}

export function formatRelativeCheck(
	checkedAt: number,
	now: number = Date.now(),
): string {
	const minutes = Math.floor((now - checkedAt) / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function formatReleaseDate(epochMillis: number): string {
	return new Date(epochMillis).toLocaleDateString(undefined, {
		dateStyle: "medium",
	});
}

export const demoRelease: ReleaseInfo = {
	version: "0.9.4",
	releasedAt: Date.parse("2026-07-14T09:00:00.000Z"),
	releaseNotesUrl: "https://github.com/remit-mail/reader/releases/tag/v0.9.4",
	summary:
		"Faster first sync on large mailboxes, and search no longer misses mail moved between folders.",
};

export const demoLogsCommand = "remit logs --since 10m";
