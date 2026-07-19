import { AwsRum } from "aws-rum-web";
import { getRuntimeConfig } from "../runtime-config";
import type { Telemetry } from "./telemetry";
import { noopTelemetry } from "./telemetry";

const ID_TOKEN_PATTERN =
	/([?&](token|access_token|id_token|authorization)=[^&]*)|\/messages\/[a-z0-9_-]+/gi;

function scrubIds(value: string): string {
	return value.replace(ID_TOKEN_PATTERN, "[redacted]");
}

function sanitizePath(path: string): string {
	const qIndex = path.indexOf("?");
	const hIndex = path.indexOf("#");
	const cutAt =
		qIndex === -1 && hIndex === -1
			? path.length
			: qIndex === -1
				? hIndex
				: hIndex === -1
					? qIndex
					: Math.min(qIndex, hIndex);
	return scrubIds(path.slice(0, cutAt));
}

function scrubErrorMessage(error: Error): Error {
	const scrubbed = scrubIds(error.message);
	if (scrubbed === error.message) {
		return error;
	}
	const next = new Error(scrubbed);
	next.name = error.name;
	next.stack = error.stack;
	return next;
}

export function createRumTelemetry(rum: AwsRum): Telemetry {
	return {
		recordPageView(path: string): void {
			rum.recordPageView(sanitizePath(path));
		},

		recordError(error: Error, context?: Record<string, string>): void {
			rum.recordError(scrubErrorMessage(error));
			if (context) {
				rum.recordEvent("telemetry.error_context", context);
			}
		},

		recordEvent(name: string, attributes?: Record<string, string>): void {
			rum.recordEvent(name, attributes ?? {});
		},

		recordTiming(
			name: string,
			durationMs: number,
			attributes?: Record<string, string>,
		): void {
			rum.recordEvent("telemetry.timing", {
				...attributes,
				name,
				durationMs: String(durationMs),
			});
		},
	};
}

function toError(reason: unknown): Error {
	if (reason instanceof Error) {
		return reason;
	}
	return new Error(String(reason));
}

function installGlobalErrorHandlers(telemetry: Telemetry): void {
	window.addEventListener("error", (event: ErrorEvent): void => {
		telemetry.recordError(toError(event.error ?? event.message));
	});
	window.addEventListener(
		"unhandledrejection",
		(event: PromiseRejectionEvent): void => {
			telemetry.recordError(toError(event.reason));
		},
	);
}

export function initRum(): Telemetry {
	const { appMonitorId, identityPoolId, region } = getRuntimeConfig().rum;
	if (!appMonitorId) {
		return noopTelemetry;
	}

	const rum = new AwsRum(appMonitorId, "1.0.0", region, {
		sessionSampleRate: 1,
		identityPoolId,
		endpoint: `https://dataplane.rum.${region}.amazonaws.com`,
		telemetries: ["performance"],
		disableAutoPageView: true,
		allowCookies: false,
		enableXRay: false,
	});

	const telemetry = createRumTelemetry(rum);
	installGlobalErrorHandlers(telemetry);
	return telemetry;
}
