import { Router, type IRouter } from "express";
import { addFlashcards, addMaterial, addTest, getCourseForStudent, getMaterialForStudent, getStudent, listCourseMaterials, materialView, removeMaterial } from "../lib/asr-store";
import { countPdfPages, extractPdfText, parseMultipart } from "../lib/pdf";
import { generateStudyMaterials, GeminiGenerationError } from "../lib/gemini";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();
const MAX_PAGES = 30;
const MIN_CHARS_PER_PAGE = 100;
const MAX_TEXT = 60_000;

function failureReason(type: "scanned_pdf" | "generation_error" | "quota_exhausted", coursePages?: number, filePages?: number) {
  if (type === "scanned_pdf") return "This PDF looks like a scanned or camera-snapped document with no selectable text. Only typed, text-based PDFs are supported. Please export/upload a typed version of this document.";
  if (type === "quota_exhausted") return "Your Gemini API key has run out of available credits/quota, so we couldn't generate study materials for this file. Check your usage or billing at Google AI Studio, then retry once your quota resets or is topped up.";
  return "Something went wrong while generating your study materials. This wasn't a problem with your file — you can safely try again.";
}

function saveGeneratedContent(materialId: string, courseId: string, fileName: string, cardsInput: Array<{ front: string; back: string }>, questions: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }>) {
  const cards = addFlashcards(cardsInput.map((card) => ({
    materialId,
    courseId,
    front: card.front,
    back: card.back,
  })));
  const test = addTest({ materialId, courseId, materialName: fileName, questions });
  return { cards, test };
}

router.get("/courses/:courseId/materials", requireAuth, (req: AuthenticatedRequest, res): void => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  if (!getCourseForStudent(courseId, req.studentId!)) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  res.json(listCourseMaterials(courseId).map(materialView));
});

router.post("/courses/:courseId/materials", requireAuth, (req: AuthenticatedRequest, res): void => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = getCourseForStudent(courseId, req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  const contentType = String(req.headers["content-type"] ?? "");
  const upload = Buffer.isBuffer(req.body) ? parseMultipart(req.body, contentType) : null;
  if (!upload || upload.mimeType !== "application/pdf") {
    res.status(400).json({ error: "Only application/pdf files are supported." });
    return;
  }
  const pageCount = countPdfPages(upload.bytes);
  if (course.totalPageCount + pageCount > MAX_PAGES) {
    res.status(400).json({ error: `This course already has ${course.totalPageCount} of 30 pages used. This file has ${pageCount} pages, which would put you over the limit. Upload a shorter file, or remove an existing material from this course first.` });
    return;
  }
  const rawText = extractPdfText(upload.bytes);
  const extractedText = rawText.slice(0, MAX_TEXT);
  const material = addMaterial({
    courseId: course.id,
    originalFileName: upload.fileName,
    pageCount,
    extractedCharCount: extractedText.length,
    extractedText,
    status: "validating",
    failureType: null,
    failureReason: null,
    flashcardCount: 0,
    questionCount: 0,
  });
  course.totalPageCount += pageCount;
  res.status(202).json(materialView(material));

  setTimeout(async () => {
    if (extractedText.length / pageCount < MIN_CHARS_PER_PAGE) {
      material.status = "failed";
      material.failureType = "scanned_pdf";
      material.failureReason = failureReason("scanned_pdf");
      course.totalPageCount = Math.max(0, course.totalPageCount - pageCount);
      return;
    }
    material.status = "generating";
    try {
      const student = getStudent(course.studentId);
      if (!student) throw new GeminiGenerationError("Student account not found.");
      const generated = await generateStudyMaterials(student.encryptedGeminiKey, material.originalFileName, extractedText);
      const saved = saveGeneratedContent(material.id, course.id, material.originalFileName, generated.cards, generated.questions);
      material.flashcardCount = saved.cards.length;
      material.questionCount = saved.test.questions.length;
      material.status = "ready";
    } catch (error) {
      material.status = "failed";
      material.failureType = error instanceof GeminiGenerationError && error.quota ? "quota_exhausted" : "generation_error";
      material.failureReason = failureReason(material.failureType);
      course.totalPageCount = Math.max(0, course.totalPageCount - pageCount);
    }
  }, 650);
});

router.get("/materials/:materialId", requireAuth, (req: AuthenticatedRequest, res): void => {
  const materialId = Array.isArray(req.params.materialId) ? req.params.materialId[0] : req.params.materialId;
  const material = getMaterialForStudent(materialId, req.studentId!);
  if (!material) {
    res.status(404).json({ error: "Material not found." });
    return;
  }
  res.json(materialView(material));
});

router.delete("/materials/:materialId", requireAuth, (req: AuthenticatedRequest, res): void => {
  const materialId = Array.isArray(req.params.materialId) ? req.params.materialId[0] : req.params.materialId;
  const material = getMaterialForStudent(materialId, req.studentId!);
  if (!material) {
    res.status(404).json({ error: "Material not found." });
    return;
  }
  if (["validating", "extracting", "generating"].includes(material.status)) {
    res.status(409).json({ error: "This material is still processing. Try again when it finishes." });
    return;
  }
  removeMaterial(material.id);
  res.sendStatus(204);
});

router.post("/materials/:materialId/retry", requireAuth, (req: AuthenticatedRequest, res): void => {
  const materialId = Array.isArray(req.params.materialId) ? req.params.materialId[0] : req.params.materialId;
  const material = getMaterialForStudent(materialId, req.studentId!);
  if (!material) {
    res.status(404).json({ error: "Material not found." });
    return;
  }
  if (!["generation_error", "quota_exhausted"].includes(material.failureType ?? "")) {
    res.status(400).json({ error: "Only generation or quota failures can be retried." });
    return;
  }
  material.status = "generating";
  material.failureType = null;
  material.failureReason = null;
  res.status(202).json(materialView(material));
  setTimeout(async () => {
    try {
      const course = getCourseForStudent(material.courseId, req.studentId!);
      const student = course ? getStudent(course.studentId) : null;
      if (!student) throw new GeminiGenerationError("Student account not found.");
      const generated = await generateStudyMaterials(student.encryptedGeminiKey, material.originalFileName, material.extractedText);
      const saved = saveGeneratedContent(material.id, material.courseId, material.originalFileName, generated.cards, generated.questions);
      material.flashcardCount = saved.cards.length;
      material.questionCount = saved.test.questions.length;
      material.status = "ready";
    } catch (error) {
      material.status = "failed";
      material.failureType = error instanceof GeminiGenerationError && error.quota ? "quota_exhausted" : "generation_error";
      material.failureReason = failureReason(material.failureType);
    }
  }, 500);
});

export default router;