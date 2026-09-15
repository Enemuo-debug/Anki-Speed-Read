import { Router, type IRouter } from "express";
import {
  addAttempt,
  getCourseForStudent,
  getMaterialForStudent,
  getTest,
  getTestByMaterial,
  listCourseFlashcards,
  listStudentAttempts,
  listStudentCourses,
} from "../lib/asr-store";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/courses/:courseId/flashcards", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  if (!(await getCourseForStudent(courseId, req.studentId!))) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  const cards = await listCourseFlashcards(courseId);
  res.json(cards.map((card) => ({ id: card.id, materialId: card.materialId, front: card.front, back: card.back })));
});

router.get("/materials/:materialId/test", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const materialId = Array.isArray(req.params.materialId) ? req.params.materialId[0] : req.params.materialId;
  const material = await getMaterialForStudent(materialId, req.studentId!);
  if (!material) {
    res.status(404).json({ error: "Material not found." });
    return;
  }
  const found = await getTestByMaterial(materialId);
  if (!found) {
    res.status(404).json({ error: "This test is not ready yet." });
    return;
  }
  res.json(found);
});

router.post("/tests/:testId/attempts", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const testId = Array.isArray(req.params.testId) ? req.params.testId[0] : req.params.testId;
  const test = await getTest(testId);
  if (!test || !(await getCourseForStudent(test.courseId, req.studentId!))) {
    res.status(404).json({ error: "Test not found." });
    return;
  }
  const answers = req.body?.answers;
  if (!Array.isArray(answers)) {
    res.status(400).json({ error: "Submit one answer for each question." });
    return;
  }
  const score = test.questions.reduce((total, question, index) => total + (Number(answers[index]) === question.correctIndex ? 1 : 0), 0);
  const attempt = await addAttempt({
    studentId: req.studentId!,
    testId: test.id,
    materialName: test.materialName,
    answers: answers.map(Number),
    score,
    totalQuestions: test.questions.length,
  });
  res.status(201).json(attempt);
});

router.get("/students/me/attempts", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const attempts = await listStudentAttempts(req.studentId!);
  res.json(attempts);
});

router.get("/students/me/summary", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const [courses, attempts] = await Promise.all([listStudentCourses(req.studentId!), listStudentAttempts(req.studentId!)]);
  let flashcardCount = 0;
  for (const course of courses) {
    const cards = await listCourseFlashcards(course.id);
    flashcardCount += cards.length;
  }
  const totalScore = attempts.reduce((sum, attempt) => sum + (attempt.score / Math.max(1, attempt.totalQuestions)) * 100, 0);
  res.json({
    courseCount: courses.length,
    pageCount: courses.reduce((sum, course) => sum + course.totalPageCount, 0),
    flashcardCount,
    averageScore: attempts.length ? Math.round(totalScore / attempts.length) : 0,
    recentAttempts: attempts.slice(0, 5).map((attempt) => ({ id: attempt.id, testId: attempt.testId, materialName: attempt.materialName, score: attempt.score, totalQuestions: attempt.totalQuestions, takenAt: attempt.takenAt })),
  });
});

export default router;