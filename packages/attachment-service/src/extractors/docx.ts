import mammoth from "mammoth";

export const extractDocxText = async (bytes: Buffer): Promise<string> => {
	const result = await mammoth.extractRawText({ buffer: bytes });
	return result.value;
};
