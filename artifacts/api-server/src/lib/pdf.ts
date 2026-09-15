import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type MultipartUpload = { fileName: string; mimeType: string; bytes: Buffer };

export function parseMultipart(body: Buffer, contentType: string): MultipartUpload | null {
  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);
  if (!boundaryMatch) return null;
  const boundary = Buffer.from(`--${boundaryMatch[1]}`);
  const start = body.indexOf(boundary);
  if (start < 0) return null;
  const headerStart = body.indexOf(Buffer.from("\r\n\r\n"), start);
  if (headerStart < 0) return null;
  const headers = body.subarray(start, headerStart).toString("utf8");
  const fileNameMatch = headers.match(/filename="([^"]+)"/i);
  const mimeTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
  const dataStart = headerStart + 4;
  const dataEnd = body.indexOf(boundary, dataStart);
  if (!fileNameMatch || dataEnd < 0) return null;
  const bytes = body.subarray(dataStart, Math.max(dataStart, dataEnd - 2));
  return { fileName: fileNameMatch[1], mimeType: mimeTypeMatch?.[1].trim() ?? "application/octet-stream", bytes };
}

export type PdfAnalysis = { pageCount: number; text: string };

export async function analyzePdf(bytes: Buffer): Promise<PdfAnalysis> {
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  try {
    const pageCount = doc.numPages;
    const chunks: string[] = [];
    let total = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if ("str" in item) {
          pageText += item.str;
          pageText += item.hasEOL ? "\n" : " ";
        }
      }
      page.cleanup();
      chunks.push(pageText);
      total += pageText.length;
      if (total > 70_000) break;
    }
    return { pageCount, text: chunks.join("\n").trim() };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}