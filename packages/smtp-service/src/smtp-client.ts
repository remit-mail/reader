import type { TestResult } from "@remit/data-ports";
import nodemailer from "nodemailer";
import type { SMTPTransportGetSocket } from "nodemailer/lib/smtp-transport";
import { type MailMessage, toNodemailerOptions } from "./message-builder.js";

/**
 * Discriminated union of SMTP authentication credentials.
 *
 * Mirrors MailCredentials in remit-mailbox-service. Defined here to avoid a
 * cross-package dependency — smtp-service does not depend on mailbox-service.
 */
export type SmtpCredentials =
	| { kind: "password"; password: string }
	| { kind: "accessToken"; accessToken: string };

/**
 * Classification of SMTP connection / send errors.
 */
export type SmtpErrorKind = "auth" | "network";

/**
 * Typed error for SMTP authentication and network failures.
 *
 * IMPORTANT: access tokens must NEVER appear in error messages.
 */
export class SmtpConnectionError extends Error {
	readonly kind: SmtpErrorKind;
	/** The whole message, end-of-data included, was written before it failed. */
	readonly afterData: boolean;

	constructor(
		kind: SmtpErrorKind,
		message: string,
		cause?: unknown,
		afterData = false,
	) {
		super(message, { cause });
		this.name = "SmtpConnectionError";
		this.kind = kind;
		this.afterData = afterData;
	}
}

export type SmtpGetSocket = SMTPTransportGetSocket;

export interface SmtpServerConfig {
	host: string;
	port: number;
	secure: boolean; // true for TLS (465), false for STARTTLS (587)
	credentials: SmtpCredentials;
	user: string;
	tls?: {
		rejectUnauthorized?: boolean; // false to accept self-signed certs (testing only)
	};
	connectionTimeout?: number; // milliseconds, default 30000
}

export const directSmtpSocket: SmtpGetSocket = (_request, callback) => {
	queueMicrotask(() => callback(null, false));
};

export interface SmtpConfig extends SmtpServerConfig {
	getSocket: SmtpGetSocket;
}

export interface SendResult {
	success: boolean;
	messageId?: string | undefined;
	response?: string | undefined;
	error?: Error | undefined;
	smtpCode?: number | undefined;
	isTransient: boolean;
}

/**
 * Build nodemailer auth from SmtpCredentials.
 * IMPORTANT: never include accessToken values in error messages.
 */
const buildSmtpAuth = (
	user: string,
	credentials: SmtpCredentials,
):
	| { user: string; pass: string }
	| { type: "OAuth2"; user: string; accessToken: string } => {
	if (credentials.kind === "password") {
		return { user, pass: credentials.password };
	}
	if (credentials.kind === "accessToken") {
		return {
			type: "OAuth2" as const,
			user,
			accessToken: credentials.accessToken,
		};
	}
	// Exhaustiveness check — fails to compile if a new credential kind is added
	// without handling it here.
	const _exhaustive: never = credentials;
	throw new Error(`Unknown credential kind: ${JSON.stringify(_exhaustive)}`);
};

type SmtpFailure = Error & {
	responseCode?: number;
	code?: string;
	command?: string;
	response?: string;
	originalCode?: string;
};

/**
 * nodemailer's own codes for a connection that failed. It moves the system
 * code (`ECONNRESET`, `ECONNREFUSED`) to `originalCode`.
 */
const NETWORK_ERROR_CODES = new Set([
	"ECONNECTION",
	"ESOCKET",
	"ETIMEDOUT",
	"EDNS",
	"ETLS",
]);

const noop = (): void => undefined;

/**
 * A nodemailer logger that only records whether the whole message, end of
 * data included, was written to the socket: the one point after which the
 * server may hold a copy.
 */
const dataWatch = () => {
	const watch = {
		afterData: false,
		logger: {
			trace: noop,
			debug: noop,
			warn: noop,
			error: noop,
			fatal: noop,
			info: (entry: unknown) => {
				if (
					typeof entry === "object" &&
					entry !== null &&
					"tnx" in entry &&
					entry.tnx === "message"
				) {
					watch.afterData = true;
				}
			},
		},
	};
	return watch;
};

const VERIFY_TIMEOUT_MS = 12_000;

const transporterFor = (
	config: SmtpConfig,
	socketTimeout: number,
	logger: ReturnType<typeof dataWatch>["logger"] | false = false,
) => {
	const timeout = config.connectionTimeout ?? 30_000;
	return nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: buildSmtpAuth(config.user, config.credentials),
		tls: config.tls,
		connectionTimeout: timeout,
		greetingTimeout: timeout,
		socketTimeout,
		getSocket: config.getSocket,
		logger,
	});
};

const classifySmtpError = (
	error: SmtpFailure,
	afterData = false,
): SmtpConnectionError | null => {
	const smtpCode = error.responseCode;

	if (
		error.code === "EAUTH" ||
		(smtpCode !== undefined && smtpCode >= 500 && error.command === "AUTH")
	) {
		// The server's own words, when it gave any: a 535 reading
		// "SmtpClientAuthentication is disabled for the Tenant" is not a
		// failure signing in again clears, and the account card can only
		// say so if the text survives the classification.
		return new SmtpConnectionError(
			"auth",
			error.response
				? `SMTP authentication failed: ${error.response.trim()}`
				: "SMTP authentication failed",
			error,
		);
	}

	if (error.code !== undefined && NETWORK_ERROR_CODES.has(error.code)) {
		return new SmtpConnectionError(
			"network",
			`SMTP connection failed: ${error.originalCode ?? error.code}`,
			error,
			afterData,
		);
	}

	return null;
};

/**
 * Send email via SMTP using Nodemailer
 */
export const sendMail = async (
	config: SmtpConfig,
	message: MailMessage,
): Promise<SendResult> => {
	const watch = dataWatch();
	const transporter = transporterFor(config, 300_000, watch.logger);

	return transporter
		.sendMail(toNodemailerOptions(message))
		.then((info) => ({
			success: true,
			messageId: info.messageId,
			response: info.response,
			isTransient: false,
		}))
		.catch((error: SmtpFailure) => {
			const classified = classifySmtpError(error, watch.afterData);
			if (classified) {
				throw classified;
			}

			// 4xx = transient (retry), 5xx = permanent (no retry)
			const smtpCode = error.responseCode;
			const isTransient =
				smtpCode !== undefined && smtpCode >= 400 && smtpCode < 500;
			return {
				success: false,
				error,
				smtpCode,
				isTransient,
			};
		})
		.finally(() => transporter.close());
};

export const verifySmtpConnection = async (
	config: SmtpConfig,
): Promise<TestResult> => {
	const transporter = transporterFor(
		{
			...config,
			connectionTimeout: config.connectionTimeout ?? VERIFY_TIMEOUT_MS,
		},
		VERIFY_TIMEOUT_MS,
	);

	return transporter
		.verify()
		.then((): TestResult => ({ success: true }))
		.catch(
			(error: SmtpFailure): TestResult => ({
				success: false,
				error: (classifySmtpError(error) ?? error).message,
			}),
		)
		.finally(() => transporter.close());
};
