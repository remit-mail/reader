export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
export const SUMMARY_MAX_LENGTH = 140;

export function assertValidVersion(version) {
	if (!RELEASE_TAG_PATTERN.test(version)) {
		throw new Error(`"${version}" is not a valid release tag; expected vX.Y.Z`);
	}
}

export function extractSummary(tagMessage) {
	const summary = tagMessage.split("\n")[0].trim();
	if (summary.length === 0) {
		throw new Error("the tag annotation message has no summary line");
	}
	if (summary.length > SUMMARY_MAX_LENGTH) {
		throw new Error(
			`the tag summary is ${summary.length} characters; the manifest allows at most ${SUMMARY_MAX_LENGTH}`,
		);
	}
	return summary;
}
