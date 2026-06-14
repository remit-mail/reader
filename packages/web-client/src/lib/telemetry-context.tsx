import { createContext, useContext } from "react";
import type { Telemetry } from "./telemetry";
import { noopTelemetry } from "./telemetry";

export const TelemetryContext = createContext<Telemetry>(noopTelemetry);

export function useTelemetry(): Telemetry {
	return useContext(TelemetryContext);
}
