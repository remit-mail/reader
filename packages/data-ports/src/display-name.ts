const EMBEDDED_ADDRESS =
	/[^\s@<>()[\],;:"'\\]+@[^\s@<>()[\],;:"'\\]+\.[^\s@<>()[\],;:"'\\.]{2,}/gu;

const DELIMITER_PAIR_LEFT_EMPTY = /[<([{"']\s*[>)\]}"']/gu;

const LEADING_OR_TRAILING_SEPARATORS = /^[\s,;:|/\\-]+|[\s,;:|/\\-]+$/gu;

const tidyAfterAddressRemoval = (text: string): string =>
	text
		.replace(DELIMITER_PAIR_LEFT_EMPTY, " ")
		.replace(/\s+/gu, " ")
		.replace(LEADING_OR_TRAILING_SEPARATORS, "")
		.trim();

const carriesAddressOtherThan = (
	text: string,
	ownAddress: string | undefined,
): boolean => {
	for (const [address] of text.matchAll(EMBEDDED_ADDRESS)) {
		if (address.toLowerCase() !== ownAddress) return true;
	}
	return false;
};

export const storedDisplayName = (
	displayName: string | undefined,
	normalizedEmail: string | undefined,
): string => {
	if (!displayName) return "";
	const ownAddress = normalizedEmail?.toLowerCase();
	if (!carriesAddressOtherThan(displayName, ownAddress)) return displayName;

	const remainder = tidyAfterAddressRemoval(
		displayName.replace(EMBEDDED_ADDRESS, (address) =>
			address.toLowerCase() === ownAddress ? address : " ",
		),
	);
	if (!remainder || carriesAddressOtherThan(remainder, ownAddress)) return "";
	return remainder;
};
