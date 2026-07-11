import { PDFParse } from "pdf-parse";

export interface PdfExtractionResult {
	text: string;
	pages: number;
}

export const extractPdfText = async (
	bytes: Buffer,
): Promise<PdfExtractionResult> => {
	const parser = new PDFParse({ data: bytes });
	try {
		const result = await parser.getText();
		return { text: result.text, pages: result.total };
	} finally {
		await parser.destroy();
	}
};
