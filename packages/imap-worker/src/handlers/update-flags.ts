import type { Logger } from "@remit/logger-lambda";
import type { UpdateFlagsEvent } from "../events.js";

export const updateFlags = async (
	event: UpdateFlagsEvent,
	log: Logger,
): Promise<void> => {
	log.info({ event }, "Update flags not implemented yet");
};
