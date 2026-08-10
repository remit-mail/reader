import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	SystemUpdateCheck,
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
 * How long a request left unpicked-up on the control seam still means
 * something. Past this, nobody is plausibly still waiting on it, and an
 * updater that finally comes up must not act on it late (issue #587) — the
 * client's own apply overlay gives up on the same order of time (fifteen
 * minutes), so this is the window the two sides already agree an answer is
 * due within.
 */
const REQUEST_TTL_MS = 15 * 60 * 1000;

const expiresAt = (requestedAt: string): string =>
	new Date(Date.parse(requestedAt) + REQUEST_TTL_MS).toISOString();

const isExpired = (isoExpiresAt: string, now: Date = new Date()): boolean =>
	now.getTime() > Date.parse(isoExpiresAt);

/**
 * Write `request.json` atomically with exactly the five fields the seam
 * accepts (#133, #587). The updater resolves the registry and every image
 * reference from the manifest it fetches itself; a request naming any of
 * those is rejected whole, so the backend never writes one. The temp file
 * sits in the same directory as the target for the rename to be atomic on one
 * filesystem.
 */
const writeRequest = (request: {
	runId: string;
	targetVersion: string;
	requestedAt: string;
	requestedBy: string;
}): void => {
	const dir = controlDir();
	const body = { ...request, expiresAt: expiresAt(request.requestedAt) };
	const tmp = join(dir, `.request.json.${request.runId}.tmp`);
	writeFileSync(tmp, JSON.stringify(body), { mode: 0o644 });
	renameSync(tmp, join(dir, "request.json"));
};

const CHECK_REQUEST_FILE = "check-request.json";

interface CheckRequest {
	requestedAt: string;
	requestedBy: string;
	expiresAt: string;
}

/**
 * Write `check-request.json` atomically, carrying an expiry from the moment
 * it is written (#587, #599): a check nobody is waiting on any more must not
 * run — or claim to still be running — whenever the updater next looks.
 */
const writeCheckRequest = (request: {
	requestedAt: string;
	requestedBy: string;
}): void => {
	const dir = controlDir();
	const body: CheckRequest = {
		...request,
		expiresAt: expiresAt(request.requestedAt),
	};
	const tmp = join(dir, `.check-request.json.${randomUUID()}.tmp`);
	writeFileSync(tmp, JSON.stringify(body), { mode: 0o644 });
	renameSync(tmp, join(dir, CHECK_REQUEST_FILE));
};

/**
 * Read `check-request.json` off the control volume. Absent — never asked, or
 * already consumed by the updater — reads as `null`.
 */
const readCheckRequest = (): CheckRequest | null => {
	let raw: string;
	try {
		raw = readFileSync(join(controlDir(), CHECK_REQUEST_FILE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	return JSON.parse(raw) as CheckRequest;
};

/**
 * The check request the updater still owes an answer to, or `null` when there
 * is none — either nothing was asked, or the request has expired. An expired
 * file left on the seam is not in flight: it does not block a fresh request,
 * and its poller is told the wait is over rather than left spinning (#599).
 */
const pendingCheckRequest = (): CheckRequest | null => {
	const request = readCheckRequest();
	if (!request || isExpired(request.expiresAt)) return null;
	return request;
};

/** Every field the last check reported, with the status moved to `pending`. */
const asPendingCheck = (
	check: SystemUpdateCheck | undefined,
): SystemUpdateCheck => ({
	...(check ?? { status: "disabled" }),
	status: "pending",
});

/**
 * The resource returned by the POST. The updater has not yet written the
 * authoritative run — it polls the seam — so this bootstraps the run block with
 * the id just requested and the first phase, giving the client a `runId` to poll
 * for (RFC 037 D9). The updater's own `state.json` supersedes it on the next
 * read.
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

/**
 * The resource returned by the check POST: the check block moved to `pending`
 * with every other field carried over, so the panel can show the last known
 * answer alongside "checking now" rather than blanking (#599). The run block
 * is untouched — a check never starts, ends or interacts with a run.
 */
const requestedCheckResource = (
	state: SystemUpdateResponse | null,
): SystemUpdateResponse => ({
	currentVersion: state?.currentVersion ?? UNKNOWN_VERSION,
	check: asPendingCheck(state?.check),
	run: state?.run ?? null,
});

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

		const resource = readState() ?? emptyResource();

		if (pendingCheckRequest()) {
			return { ...resource, check: asPendingCheck(resource.check) };
		}

		// A request sat on the seam past its expiry with nobody having answered
		// it — the updater is dead, stopped, or has not reached its watch loop.
		// The wait is reported as over rather than left spinning forever (#599);
		// the updater reaches the same verdict independently once it does start
		// (#587), so the two accounts never disagree once it does.
		if (readCheckRequest()) {
			return {
				...resource,
				check: {
					...resource.check,
					status: "failed",
					error:
						"The updater did not answer the check request before it expired.",
				},
			};
		}

		return resource;
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

	SystemOperations_requestSystemUpdateCheck: async (
		_context: Context,
		...args: unknown[]
	): Promise<SystemUpdateResponse | APIGatewayProxyResult> => {
		const offSurface = guardManifestConfigured();
		if (offSurface) return offSurface;

		const event = args[0] as APIGatewayProxyEvent;
		const sub = getSubFromEvent(event);
		if (!sub) return unauthorized();

		if (pendingCheckRequest()) {
			throw new ConflictError("A check is already in progress.");
		}

		const state = readState();
		const requestedAt = new Date().toISOString();
		writeCheckRequest({ requestedAt, requestedBy: sub });

		return {
			statusCode: 202,
			body: requestedCheckResource(state),
		} as unknown as APIGatewayProxyResult;
	},
};
