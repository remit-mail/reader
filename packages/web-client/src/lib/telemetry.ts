export interface Telemetry {
	recordPageView(path: string): void;
	recordError(error: Error, context?: Record<string, string>): void;
	recordEvent(name: string, attributes?: Record<string, string>): void;
	recordTiming(
		name: string,
		durationMs: number,
		attributes?: Record<string, string>,
	): void;
}

export const noopTelemetry: Telemetry = {
	recordPageView: () => undefined,
	recordError: () => undefined,
	recordEvent: () => undefined,
	recordTiming: () => undefined,
};
