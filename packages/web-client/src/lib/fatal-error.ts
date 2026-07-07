import { recordError } from "./console-errors";
import { isServerError } from "./error-classifier";
import type { Telemetry } from "./telemetry";

/**
 * The single escalation seam for first-party fatal errors.
 *
 * Calling `reportFatalError(error)` does three things, unconditionally:
 *  1. records the error into the recent-errors ring (so the bug-report flow
 *     picks it up),
 *  2. emits a telemetry fatal-error event (when a telemetry sink is registered
 *     via `setFatalErrorTelemetry` — `main.tsx` plugs the live RUM adapter in
 *     here), and
 *  3. notifies every subscriber — the `FatalErrorOverlay` subscribes here and
 *     takes over the whole screen with the red escalation page.
 *
 * This is the one place telemetry plugs in: RUM wires in once, not per call
 * site.
 */

export interface FatalError {
	error: unknown;
	/** Human-readable message extracted from the error. */
	message: string;
	/** Correlation id for support — distinguishes one fatal from the next. */
	correlationId: string;
	/** When the fatal was reported. */
	at: number;
	/**
	 * Whether retrying the same action might succeed. A transient class — a 5xx,
	 * an offline/network blip, an aborted request — is recoverable; the overlay
	 * offers Retry. A deterministic render/exception (caught by the route error
	 * boundary) is NOT recoverable — retry re-crashes, so the overlay offers a
	 * way out (a safe route) instead.
	 */
	recoverable: boolean;
	/** The error's stack, when it is an `Error`. Seeds the bug report. */
	stack?: string;
	/** React component stack from the error boundary, when available. */
	componentStack?: string;
}

/** Options for `reportFatalError`. */
export interface ReportFatalOptions {
	/**
	 * Force the recoverable classification. Omit to derive it from the error
	 * (transient network/5xx/abort ⇒ recoverable). The route error boundary
	 * passes `false` for a caught render exception — it is deterministic.
	 */
	recoverable?: boolean;
	/** React component stack captured by the error boundary. */
	componentStack?: string;
}

/**
 * Default recoverable classification for an error with no explicit override.
 * Only a 5xx is treated as recoverable — the one clearly transient class, where
 * retrying the same action may succeed. Everything that reaches the fatal seam
 * is otherwise deterministic: aborts and offline/network blips never escalate
 * here (they are filtered upstream by `shouldEscalate`), so a statusless error
 * arriving here is an uncaught/unhandled crash, not a benign network blip.
 * A caught render exception is deterministic too — the error boundary reports
 * it with an explicit `recoverable: false` for good measure.
 */
const defaultRecoverable = (error: unknown): boolean => isServerError(error);

type FatalErrorListener = (fatal: FatalError) => void;

const listeners = new Set<FatalErrorListener>();

let current: FatalError | null = null;

let telemetry: Telemetry | null = null;

/**
 * Register the telemetry sink the fatal seam emits to. Called once from
 * `main.tsx` with the live RUM adapter (no-op telemetry when RUM is disabled).
 */
export const setFatalErrorTelemetry = (sink: Telemetry): void => {
	telemetry = sink;
};

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(messageOf(error));

const messageOf = (error: unknown): string => {
	if (error instanceof Error) return error.message || error.name;
	if (typeof error === "string") return error;
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message: unknown }).message === "string"
	) {
		return (error as { message: string }).message;
	}
	return "An unexpected server error occurred.";
};

const newCorrelationId = (): string => {
	if (
		typeof globalThis.crypto !== "undefined" &&
		typeof globalThis.crypto.randomUUID === "function"
	) {
		return globalThis.crypto.randomUUID();
	}
	return `fatal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Report a fatal, first-party error. Idempotent in spirit: the overlay shows
 * the first fatal and stays until the user reloads, so repeated calls only
 * refresh the recorded entry and re-notify (a no-op for an already-mounted
 * overlay).
 */
export const reportFatalError = (
	error: unknown,
	options?: ReportFatalOptions,
): FatalError => {
	const fatal: FatalError = {
		error,
		message: messageOf(error),
		correlationId: newCorrelationId(),
		at: Date.now(),
		recoverable: options?.recoverable ?? defaultRecoverable(error),
		stack: error instanceof Error ? error.stack : undefined,
		componentStack: options?.componentStack,
	};

	current = fatal;
	recordError(`Fatal: ${fatal.message} [${fatal.correlationId}]`);

	// Single telemetry seam: emit the fatal through RUM (epic #658). Scrubbing
	// of ids/tokens happens inside the RUM adapter.
	telemetry?.recordError(toError(error), {
		fatal: "true",
		correlationId: fatal.correlationId,
	});

	for (const listener of listeners) {
		listener(fatal);
	}

	return fatal;
};

/** Subscribe to fatal errors. Returns an unsubscribe function. */
export const subscribeFatalError = (
	listener: FatalErrorListener,
): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** The most recent fatal error, if any — lets a late subscriber catch up. */
export const getCurrentFatalError = (): FatalError | null => current;

/** Test-only: clear the in-memory fatal state, listeners, and telemetry sink. */
export const __resetFatalError = (): void => {
	current = null;
	listeners.clear();
	telemetry = null;
};
