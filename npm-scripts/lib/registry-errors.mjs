// Reading npm's failures by their error code. The publish decision asks the
// registry two questions — is this package there, and is this version there —
// and npm answers both as a failed command with the code in its output. Shared
// so the two callers can never disagree about what "not there" looks like.

const errorText = (error) =>
	`${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;

export const isMissingPackage = (error) => errorText(error).includes("404");

export const isMissingVersion = (error) => {
	const text = errorText(error);
	return text.includes("ETARGET") || text.includes("404");
};
