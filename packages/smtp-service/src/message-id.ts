import { randomBytes } from "node:crypto";

/**
 * Generate RFC 2822 compliant Message-ID
 * Format: <timestamp.random@domain>
 */
export const generateMessageId = (domain: string): string => {
	const timestamp = Date.now();
	const random = randomBytes(8).toString("hex");
	return `${timestamp}.${random}@${domain}`;
};

/**
 * Extract domain from email address for Message-ID generation
 */
export const extractDomain = (email: string): string => {
	const atIndex = email.lastIndexOf("@");
	if (atIndex === -1) {
		throw new Error(`Invalid email address: ${email}`);
	}
	return email.slice(atIndex + 1);
};
