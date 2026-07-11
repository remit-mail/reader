export const extractPlainText = (bytes: Buffer): string => {
	const utf8 = bytes.toString("utf8");
	if (!utf8.includes("�")) return utf8;
	return bytes.toString("latin1");
};
