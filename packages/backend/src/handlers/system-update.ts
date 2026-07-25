import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	SystemUpdateResponse,
	SystemUpdateRun,
} from "@remit/api-openapi-types";
import { ConflictError, HTTPError } from "@remit/data-ports/errors";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Context } from "openapi-backend";
import { getSubFromEvent } from "../auth.js";
import type { OperationHandler, SystemOperationIds } from "../types.js";

class TargetVersionMismatchError extends HTTPError {
	name = "TargetVersionMismatchError";
	statusCode = 422;
}

const DEFAULT_CONTROL_DIR = "/data/control";

const controlDir = (): string =>
	process.env.REMIT_UPDATE_CONTROL_DIR ?? DEFAULT_CONTROL_DIR;

const manifestUrl = (): string | undefined =>
	process.env.REMIT_UPDATE_MANIFEST_URL;

/**
 * The running version is a fact the updater owns: it reads the tag from `.env`
 * and writes it into `state.json`, which is the only honest source across an
 * update that rewrites that tag underneath a long-lived backend process. When no
 * state file exists yet the backend has nothing authoritative to report, so it
 * reports the version as unknown rather than fabricating one from its own
 * process environment — a value captured at container start that drifts from the
 * real running tag the moment an update lands. The first updater check writes a
 * real `currentVersion` within seconds of the stack coming up.
 */
const UNKNOWN_VERSION = "unknown";

const notFound = (): APIGatewayProxyResult => ({
	statusCode: 404,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ message: "Not found" }),
});

const unauthorized = (): APIGatewayProxyResult => ({
	statusCode: 401,
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ message: "Unauthorized" }),
});

/**
 * The self-update seam is off unless a manifest URL is configured (RFC 037 D8),
 * which the hosted deployment leaves unset. Both endpoints answer 404 in that
 * case. Where it is on, any authenticated caller may use it — the account list
 * is the trust boundary of a self-hosted instance.
 */
const guardManifestConfigured = (): APIGatewayProxyResult | null =>
	manifestUrl() ? null : notFound();

/**
 * Read `state.json` off the control volume. A missing file is an instance that
 * has never checked or updated (RFC 037 D8), not an error, so it reads as
 * `null`; the caller renders the disabled/empty resource. Any other read or
 * parse failure propagates.
 */
const readState = (): SystemUpdateResponse | null => {
	let raw: string;
	try {
		raw = readFileSync(join(controlDir(), "state.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	return JSON.parse(raw) as SystemUpdateResponse;
};

const emptyResource = (): SystemUpdateResponse => ({
	currentVersion: UNKNOWN_VERSION,
	check: { status: "disabled" },
	run: null,
});

const isRunInFlight = (run: SystemUpdateRun | null | undefined): boolean =>
	run != null && run.outcome === null;

/**
 * The version the caller may install is the one the last check reported. It
 * exists only on a successful check; a disabled or failed check offers nothing
 * to match, so any target is a mismatch.
 */
const checkedVersion = (
	state: SystemUpdateResponse | null,
): string | undefined =>
	state?.check.status === "ok" ? state.check.latestVersion : undefined;

/**
 * Write `request.json` atomically with exactly the four fields the seam accepts
 * (#133). The updater resolves the registry and every image reference from the
 * manifest it fetches itself; a request naming any of those is rejected whole,
 * so the backend never writes one. The temp file sits in the same directory as
 * the target for the rename to be atomic on one filesystem.
 */
const writeRequest = (request: {
	runId: string;
	targetVersion: string;
	requestedAt: string;
	requestedBy: string;
}): void => {
	const dir = controlDir();
	const tmp = join(dir, `.request.json.${request.runId}.tmp`);
	writeFileSync(tmp, JSON.stringify(request), { mode: 0o644 });
	renameSync(tmp, join(dir, "request.json"));
};

/**
 * The resource returned by the POST. The updater has not yet written the
 * authoritative run — it polls the seam — so this bootstraps the run block with
 * the id just requested and the first phase, giving the client a `runId` to
 * persist and poll (RFC 037 D9). The updater's own `state.json` supersedes it on
 * the next read.
 */
const requestedResource = (
	state: SystemUpdateResponse | null,
	runId: string,
	targetVersion: string,
	requestedAt: string,
): SystemUpdateResponse => {
	const from = state?.currentVersion ?? UNKNOWN_VERSION;
	return {
		currentVersion: from,
		check: state?.check ?? { status: "disabled" },
		run: {
			runId,
			fromVersion: from,
			targetVersion,
			phase: "checking",
			outcome: null,
			startedAt: requestedAt,
			updatedAt: requestedAt,
			message: "The update has been requested.",
			logCommand: "remit logs updater",
		},
	};
};

export const SystemOperations: Record<
	SystemOperationIds,
	OperationHandler<SystemOperationIds>
> = {
	SystemOperations_getSystemUpdate: async (
		_context: Context,
		...args: unknown[]
	): Promise<SystemUpdateResponse | APIGatewayProxyResult> => {
		const offSurface = guardManifestConfigured();
		if (offSurface) return offSurface;

		const event = args[0] as APIGatewayProxyEvent;
		if (!getSubFromEvent(event)) return unauthorized();

		return readState() ?? emptyResource();
	},

	SystemOperations_applySystemUpdate: async (
		context: Context,
		...args: unknown[]
	): Promise<SystemUpdateResponse | APIGatewayProxyResult> => {
		const offSurface = guardManifestConfigured();
		if (offSurface) return offSurface;

		const event = args[0] as APIGatewayProxyEvent;
		const sub = getSubFromEvent(event);
		if (!sub) return unauthorized();

		const { targetVersion } = context.request.requestBody as {
			targetVersion: string;
		};
		const state = readState();

		if (isRunInFlight(state?.run)) {
			throw new ConflictError("An update is already in progress.");
		}

		if (targetVersion !== checkedVersion(state)) {
			throw new TargetVersionMismatchError(
				"targetVersion does not match the latest checked release.",
			);
		}

		const runId = randomUUID();
		const requestedAt = new Date().toISOString();
		writeRequest({
			runId,
			targetVersion,
			requestedAt,
			requestedBy: sub,
		});

		return {
			statusCode: 202,
			body: requestedResource(state, runId, targetVersion, requestedAt),
		} as unknown as APIGatewayProxyResult;
	},
};
