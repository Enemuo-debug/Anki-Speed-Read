import { decryptGeminiKey } from "./asr-store";

type GeneratedCard = { front: string; back: string };
type GeneratedQuestion = { question: string; options: string[]; correctIndex: number; explanation: string };

export class GeminiGenerationError extends Error {
  readonly quota: boolean;

  constructor(message: string, quota = false) {
    super(message);
    this.name = "GeminiGenerationError";
    this.quota = quota;
  }
}

function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned) as T;
}

async function callGemini(encryptedKey: string, prompt: string): Promise<string> {
  const key = decryptGeminiKey(encryptedKey);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
  });
  const raw = await response.text();
  if (!response.ok) {
    const quota = response.status === 429 || /quota|resource_exhausted|billing|rate.?limit/i.test(raw);
    throw new GeminiGenerationError(quota ? "Gemini quota exhausted." : "Gemini generation failed.", quota);
  }
  try {
    const parsed = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini response.");
    return text;
  } catch {
    throw new GeminiGenerationError("Gemini returned an unreadable response.");
  }
}

export async function generateStudyMaterials(encryptedKey: string, fileName: string, extractedText: string) {
  const source = extractedText.slice(0, 60_000);
  const cardsText = await callGemini(encryptedKey, `You are generating study flashcards strictly from the provided text. Do not add outside facts. Return JSON only matching this schema: [{"front":"string","back":"string"}]. Generate between 15 and 40 cards depending on content density. Keep front concise and back complete. The source file is ${fileName}.\\n\\nSOURCE TEXT:\\n${source}`);
  const testText = await callGemini(encryptedKey, `Generate a multiple-choice test strictly from the provided text. Return JSON only matching this schema: [{"question":"string","options":["string","string","string","string"],"correctIndex":0,"explanation":"string"}]. Generate exactly 10 questions, four options each, one correct answer, and a one-sentence explanation. The source file is ${fileName}.\\n\\nSOURCE TEXT:\\n${source}`);
  const cards = parseJson<GeneratedCard[]>(cardsText);
  const questions = parseJson<GeneratedQuestion[]>(testText);
  if (!Array.isArray(cards) || cards.length < 1 || !Array.isArray(questions) || questions.length !== 10 || questions.some((question) => !Array.isArray(question.options) || question.options.length !== 4)) {
    throw new GeminiGenerationError("Gemini returned study materials in an unexpected format.");
  }
  return { cards, questions };
}