import type { SmtpGetSocket } from "./smtp-client.js";

export const nodeSocket = (): SmtpGetSocket => (_options, callback) => {
	setImmediate(() => callback(null, false));
};
