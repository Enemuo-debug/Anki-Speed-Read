import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  addFlashcards,
  addMaterial,
  addTest,
  adjustCoursePages,
  getCourseForStudent,
  getMaterialForStudent,
  getStudent,
  listCourseMaterials,
  materialView,
  removeMaterial,
} from "../lib/asr-store";
import { parseMultipart } from "../lib/pdf";
import { analyzePdf } from "../lib/pdf";
import { generateStudyMaterials, GeminiGenerationError } from "../lib/gemini";
import { uploadPdfBuffer } from "../lib/cloudinary";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();
const MAX_PAGES = 30;
const MIN_CHARS_PER_PAGE = 100;
const MAX_TEXT = 60_000;

const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many uploads right now. Please wait a minute and try again." },
});

function failureReason(type: "scanned_pdf" | "generation_error" | "quota_exhausted", coursePages?: number, filePages?: number) {
  if (type === "scanned_pdf") return "This PDF looks like a scanned or camera-snapped document with no selectable text. Only typed, text-based PDFs are supported. Please export/upload a typed version of this document.";
  if (type === "quota_exhausted") return "Your Gemini API key has run out of available credits/quota, so we couldn't generate study materials for this file. Check your usage or billing at Google AI Studio, then retry once your quota resets or is topped up.";
  return "Something went wrong while generating your study materials. This wasn't a problem with your file — you can safely try again.";
}

async function saveGeneratedContent(materialId: string, courseId: string, fileName: string, cardsInput: Array<{ front: string; back: string }>, questions: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }>) {
  const cards = await addFlashcards(cardsInput.map((card) => ({ materialId, courseId, front: card.front, back: card.back })));
  const test = await addTest({ materialId, courseId, materialName: fileName, questions });
  return { cards, test };
}

router.get("/courses/:courseId/materials", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  if (!(await getCourseForStudent(courseId, req.studentId!))) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  const materials = await listCourseMaterials(courseId);
  res.json(materials.map(materialView));
});

router.post("/courses/:courseId/materials", requireAuth, uploadLimiter, async (req: AuthenticatedRequest, res): Promise<void> => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = await getCourseForStudent(courseId, req.studentId!);
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

  let analyzed: { pageCount: number; text: string };
  try {
    analyzed = await analyzePdf(upload.bytes);
  } catch {
    res.status(400).json({ error: "We could not read this PDF. Please upload a valid, uncorrupted file." });
    return;
  }
  const pageCount = analyzed.pageCount;

  if (course.totalPageCount + pageCount > MAX_PAGES) {
    res.status(400).json({
      error: `This course already has ${course.totalPageCount} of 30 pages used. This file has ${pageCount} pages, which would put you over the limit. Upload a shorter file, or remove an existing material from this course first.`,
    });
    return;
  }

  let cloud: { secureUrl: string; publicId: string };
  try {
    cloud = await uploadPdfBuffer(upload.bytes);
  } catch {
    res.status(502).json({ error: "We could not store this PDF right now. Please try again in a moment." });
    return;
  }

  const extractedText = analyzed.text.slice(0, MAX_TEXT);
  const material = await addMaterial({
    courseId: course.id,
    originalFileName: upload.fileName,
    cloudinaryUrl: cloud.secureUrl,
    cloudinaryPublicId: cloud.publicId,
    pageCount,
    extractedCharCount: extractedText.length,
    extractedText,
    status: "uploaded",
    failureType: null,
    failureReason: null,
    flashcardCount: 0,
    questionCount: 0,
  });
  await adjustCoursePages(course.id, pageCount);
  course.totalPageCount = Math.max(0, course.totalPageCount + pageCount);
  res.status(202).json(materialView(material));

  setTimeout(async () => {
    if (extractedText.length / Math.max(1, pageCount) < MIN_CHARS_PER_PAGE) {
      material.status = "failed";
      material.failureType = "scanned_pdf";
      material.failureReason = failureReason("scanned_pdf");
      await material.save();
      await adjustCoursePages(course.id, -pageCount);
      return;
    }
    material.status = "generating";
    await material.save();
    try {
      const student = await getStudent(course.student.toString());
      if (!student) throw new GeminiGenerationError("Student account not found.");
      const generated = await generateStudyMaterials(student.encryptedGeminiKey, material.originalFileName, extractedText);
      const saved = await saveGeneratedContent(material.id, course.id, material.originalFileName, generated.cards, generated.questions);
      material.flashcardCount = saved.cards.length;
      material.questionCount = saved.test.questions.length;
      material.status = "ready";
      await material.save();
    } catch (error) {
      material.status = "failed";
      material.failureType = error instanceof GeminiGenerationError && error.quota ? "quota_exhausted" : "generation_error";
      material.failureReason = failureReason(material.failureType);
      await material.save();
      await adjustCoursePages(course.id, -pageCount);
    }
  }, 650);
});

router.get("/materials/:materialId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const materialId = Array.isArray(req.params.materialId) ? req.params.materialId[0] : req.params.materialId;
  const material = await getMaterialForStudent(materialId, req.studentId!);
  if (!material) {
    res.status(404).json({ error: "Material not found." });
    return;
  }
  res.json(materialView(material));
});

router.delete("/materials/:materialId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const materialId = Array.isArray(req.params.materialId) ? req.params.materialId[0] : req.params.materialId;
  const material = await getMaterialForStudent(materialId, req.studentId!);
  if (!material) {
    res.status(404).json({ error: "Material not found." });
    return;
  }
  if (["validating", "extracting", "generating", "uploaded"].includes(material.status)) {
    res.status(409).json({ error: "This material is still processing. Try again when it finishes." });
    return;
  }
  await removeMaterial(material.id);
  res.sendStatus(204);
});

router.post("/materials/:materialId/retry", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const materialId = Array.isArray(req.params.materialId) ? req.params.materialId[0] : req.params.materialId;
  const material = await getMaterialForStudent(materialId, req.studentId!);
  if (!material) {
    res.status(404).json({ error: "Material not found." });
    return;
  }
  if (!["generation_error", "quota_exhausted"].includes(material.failureType ?? "")) {
    res.status(400).json({ error: "Only generation or quota failures can be retried." });
    return;
  }
  const course = await getCourseForStudent(material.course.toString(), req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  material.status = "generating";
  material.failureType = null;
  material.failureReason = null;
  material.flashcardCount = 0;
  material.questionCount = 0;
  await material.save();
  await adjustCoursePages(course.id, material.pageCount);
  course.totalPageCount = Math.max(0, course.totalPageCount + material.pageCount);
  res.status(202).json(materialView(material));

  setTimeout(async () => {
    try {
      const student = await getStudent(course.student.toString());
      if (!student) throw new GeminiGenerationError("Student account not found.");
      const generated = await generateStudyMaterials(student.encryptedGeminiKey, material.originalFileName, material.extractedText);
      const saved = await saveGeneratedContent(material.id, material.course.toString(), material.originalFileName, generated.cards, generated.questions);
      material.flashcardCount = saved.cards.length;
      material.questionCount = saved.test.questions.length;
      material.status = "ready";
      await material.save();
    } catch (error) {
      material.status = "failed";
      material.failureType = error instanceof GeminiGenerationError && error.quota ? "quota_exhausted" : "generation_error";
      material.failureReason = failureReason(material.failureType);
      await material.save();
      await adjustCoursePages(course.id, -material.pageCount);
      course.totalPageCount = Math.max(0, course.totalPageCount - material.pageCount);
    }
  }, 500);
});

export default router;