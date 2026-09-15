import { Router, type IRouter } from "express";
import { getCourseForStudent, addCourse, listStudentCourses, courseSummary, listCourseMaterials, removeCourse, updateCourse } from "../lib/asr-store";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/courses", requireAuth, (req: AuthenticatedRequest, res): void => {
  res.json(listStudentCourses(req.studentId!).map(courseSummary));
});

router.post("/courses", requireAuth, (req: AuthenticatedRequest, res): void => {
  const { title, description } = req.body ?? {};
  if (typeof title !== "string" || title.trim().length < 2) {
    res.status(400).json({ error: "Give your course a title." });
    return;
  }
  res.status(201).json(courseSummary(addCourse(req.studentId!, title.trim(), typeof description === "string" ? description.trim() : "")));
});

router.patch("/courses/:courseId", requireAuth, (req: AuthenticatedRequest, res): void => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = getCourseForStudent(courseId, req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  const { title, description } = req.body ?? {};
  if (typeof title !== "string" || title.trim().length < 2) {
    res.status(400).json({ error: "Give your course a title." });
    return;
  }
  res.json(courseSummary(updateCourse(course.id, {
    title: title.trim(),
    description: typeof description === "string" ? description.trim() : "",
  })!));
});

router.get("/courses/:courseId", requireAuth, (req: AuthenticatedRequest, res): void => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = getCourseForStudent(courseId, req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  res.json({ ...courseSummary(course), materials: listCourseMaterials(course.id).map((material) => ({
    id: material.id,
    courseId: material.courseId,
    originalFileName: material.originalFileName,
    pageCount: material.pageCount,
    extractedCharCount: material.extractedCharCount,
    status: material.status,
    failureType: material.failureType,
    failureReason: material.failureReason,
    flashcardCount: material.flashcardCount,
    questionCount: material.questionCount,
    createdAt: material.createdAt,
  })) });
});

router.delete("/courses/:courseId", requireAuth, (req: AuthenticatedRequest, res): void => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = getCourseForStudent(courseId, req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  removeCourse(course.id);
  res.sendStatus(204);
});

export default router;