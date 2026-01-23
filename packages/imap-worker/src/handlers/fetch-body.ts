import type { Logger } from "@remit/logger-lambda";
import type { FetchBodyEvent } from "../events.js";

export const fetchBody = async (
	event: FetchBodyEvent,
	log: Logger,
): Promise<void> => {
	log.info({ event }, "Fetch body not implemented yet");
};
