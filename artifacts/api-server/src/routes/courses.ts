import { Router, type IRouter } from "express";
import {
  getCourseForStudent,
  addCourse,
  listStudentCourses,
  courseSummary,
  listCourseMaterials,
  materialView,
  removeCourse,
  updateCourse,
} from "../lib/asr-store";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/courses", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const courses = await listStudentCourses(req.studentId!);
  res.json(await Promise.all(courses.map((course) => courseSummary(course))));
});

router.post("/courses", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const { title, description } = req.body ?? {};
  if (typeof title !== "string" || title.trim().length < 2) {
    res.status(400).json({ error: "Give your course a title." });
    return;
  }
  const course = await addCourse(req.studentId!, title.trim(), typeof description === "string" ? description.trim() : "");
  res.status(201).json(await courseSummary(course));
});

router.patch("/courses/:courseId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = await getCourseForStudent(courseId, req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  const { title, description } = req.body ?? {};
  if (typeof title !== "string" || title.trim().length < 2) {
    res.status(400).json({ error: "Give your course a title." });
    return;
  }
  const updated = await updateCourse(course.id, {
    title: title.trim(),
    description: typeof description === "string" ? description.trim() : "",
  });
  res.json(await courseSummary(updated!));
});

router.get("/courses/:courseId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = await getCourseForStudent(courseId, req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  const materials = await listCourseMaterials(course.id);
  res.json({ ...(await courseSummary(course)), materials: materials.map(materialView) });
});

router.delete("/courses/:courseId", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const courseId = Array.isArray(req.params.courseId) ? req.params.courseId[0] : req.params.courseId;
  const course = await getCourseForStudent(courseId, req.studentId!);
  if (!course) {
    res.status(404).json({ error: "Course not found." });
    return;
  }
  await removeCourse(course.id);
  res.sendStatus(204);
});

export default router;