import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigExportIdentity } from "@remit/config-transfer";
import type { ApiConfig } from "../config/api-config.js";

/**
 * The version a file says it was written by. The updater owns this fact: it
 * reads the tag from `.env` and writes it into `state.json`, which is the only
 * honest source across an update that rewrites that tag underneath a
 * long-lived process. With no state file there is nothing authoritative to
 * stamp, and an export says so rather than inventing a version an importing
 * reader would then trust.
 */
const runningVersion = (dir: string): string => {
	let raw: string;
	try {
		raw = readFileSync(join(dir, "state.json"), "utf8");
	} catch {
		return "unknown";
	}
	const state: unknown = JSON.parse(raw);
	if (typeof state !== "object" || state === null) return "unknown";
	const version = (state as { currentVersion?: unknown }).currentVersion;
	return typeof version === "string" && version.length > 0
		? version
		: "unknown";
};

/** Who wrote a configuration file, and from where. Provenance only. */
export const exportIdentity = (
	config: Pick<ApiConfig, "updateControlDir" | "publicOrigin">,
	now: Date = new Date(),
): ConfigExportIdentity => ({
	app: "reader",
	version: runningVersion(config.updateControlDir),
	exportedAt: now.toISOString(),
	instance: config.publicOrigin,
});
