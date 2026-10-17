/**
 * A Message-ID with every surrounding angle bracket and space taken off. One
 * form whatever spelling arrived: `X`, `<X>` and the `<<X>>` reader once sent
 * all name the same message, and only the bare form says so.
 */
export const bareMessageId = (value: string): string =>
	value.replace(/^[\s<]+|[\s>]+$/g, "");

/** The one spelling a Message-ID takes on the wire: the bare id in one pair of brackets. */
export const wireMessageId = (value: string): string =>
	`<${bareMessageId(value)}>`;
