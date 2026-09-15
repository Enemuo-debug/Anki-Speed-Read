import { Router, type IRouter } from "express";
import {
  addStudent,
  createToken,
  findStudentByEmail,
  getStudent,
  studentView,
  updateStudentGeminiKey,
  verifyPassword,
} from "../lib/asr-store";
import { checkGeminiKey } from "../lib/gemini";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/signup", async (req, res): Promise<void> => {
  const { fullName, email, password, geminiApiKey } = req.body ?? {};
  if (
    typeof fullName !== "string" ||
    fullName.trim().length < 2 ||
    typeof email !== "string" ||
    !email.includes("@") ||
    typeof password !== "string" ||
    password.length < 8 ||
    typeof geminiApiKey !== "string" ||
    geminiApiKey.length < 10
  ) {
    res.status(400).json({ error: "Enter your name, a valid email, a password of at least 8 characters, and your Gemini API key." });
    return;
  }
  const existing = await findStudentByEmail(email);
  if (existing) {
    res.status(400).json({ error: "An account with that email already exists." });
    return;
  }
  const keyCheck = await checkGeminiKey(geminiApiKey.trim());
  if (!keyCheck.valid) {
    res.status(400).json({ error: keyCheck.message ?? "That Gemini API key looks invalid." });
    return;
  }
  const student = await addStudent({
    fullName: fullName.trim(),
    email: email.trim(),
    password,
    geminiApiKey: geminiApiKey.trim(),
  });
  res.status(201).json({ token: createToken(student.id), student: studentView(student) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};
  const student = typeof email === "string" ? await findStudentByEmail(email) : null;
  if (!student || typeof password !== "string" || !(await verifyPassword(student, password))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  res.json({ token: createToken(student.id), student: studentView(student) });
});

router.get("/auth/me", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const student = await getStudent(req.studentId!);
  if (!student) {
    res.status(401).json({ error: "Please log in to continue." });
    return;
  }
  res.json(studentView(student));
});

router.patch("/auth/gemini-key", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const key = req.body?.geminiApiKey;
  if (typeof key !== "string" || key.trim().length < 10) {
    res.status(400).json({ error: "Enter a valid Gemini API key." });
    return;
  }
  const keyCheck = await checkGeminiKey(key.trim());
  if (!keyCheck.valid) {
    res.status(400).json({ error: keyCheck.message ?? "That Gemini API key looks invalid." });
    return;
  }
  const student = await updateStudentGeminiKey(req.studentId!, key.trim());
  if (!student) {
    res.status(404).json({ error: "Student not found." });
    return;
  }
  res.json(studentView(student));
});

export default router;