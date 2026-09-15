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

export function countPdfPages(bytes: Buffer): number {
  const text = bytes.toString("latin1");
  const pages = [...text.matchAll(/\/Type\s*\/Page\b/g)].length;
  return Math.max(1, pages);
}

export function extractPdfText(bytes: Buffer): string {
  const source = bytes.toString("latin1");
  const chunks: string[] = [];
  for (const match of source.matchAll(/\(([^()\r\n]{2,})\)\s*T[Jj]/g)) {
    chunks.push(match[1].replace(/\\([\\()])/g, "$1"));
  }
  if (chunks.length > 0) return chunks.join(" ");
  return source
    .replace(/[^\x20-\x7E\n]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60000)
    .trim();
}