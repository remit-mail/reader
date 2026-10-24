import { inspect } from "node:util";
import { logger } from "@remit/logger";
import { installNodeLogger, withTelemetry } from "@remit/logger-lambda/node";
import { handleApiEvent } from "./api.js";

installNodeLogger();

export { api, handleApiEvent, OpenAPISpec } from "./api.js";

/**
 * Last-resort net for a leaked background rejection.
 *
 * Every fire-and-forget side effect is meant to be contained at its source (see
 * service/fire-and-forget.ts), so reaching here is a bug — an uncontained
 * `void promise` somewhere. The API process (dev-server / warm Lambda container)
 * shares one event loop across requests, so without this handler such a leak
 * would surface as a spurious 500 on whatever request was in flight. We log it
 * LOUDLY with a distinct alert so it is observable, and deliberately do NOT exit
 * — a stray background rejection must never take the API down or fail a request.
 * (The worker process intentionally has no such net: there each message is its
 * own invocation and a rejection should crash it.)
 */
const unhandledRejectionRegistered = Symbol.for(
	"remit.backend.unhandledRejectionNet",
);
const globalProcess = process as unknown as Record<symbol, boolean>;
if (!globalProcess[unhandledRejectionRegistered]) {
	globalProcess[unhandledRejectionRegistered] = true;
	process.on("unhandledRejection", (reason: unknown) => {
		logger.error(
			{
				alert: "unhandled_rejection",
				errorName: (reason as { name?: string })?.name,
				errorCode:
					(reason as { Code?: string })?.Code ??
					(reason as { code?: string })?.code,
				error: inspect(reason),
			},
			"Unhandled promise rejection leaked into the API event loop (contained, request not failed)",
		);
	});
}

// The Lambda and Node entry point. `withTelemetry` installs the Node logger and
// its process metrics; a host without Node's process APIs imports
// `@remit/backend/api` instead and plugs in its own logger with `setLogger`.
export const handler = withTelemetry(handleApiEvent);
