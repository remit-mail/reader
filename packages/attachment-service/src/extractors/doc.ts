import WordExtractor from "word-extractor";

export const extractDocText = async (bytes: Buffer): Promise<string> => {
	const extractor = new WordExtractor();
	const document = await extractor.extract(bytes);
	return document.getBody();
};
