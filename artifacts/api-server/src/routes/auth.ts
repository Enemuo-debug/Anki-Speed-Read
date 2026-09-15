import { Router, type IRouter } from "express";
import { addStudent, createToken, findStudentByEmail, getStudent, studentView, updateStudentGeminiKey, verifyPassword } from "../lib/asr-store";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/signup", (req, res): void => {
  const { fullName, email, password, geminiApiKey } = req.body ?? {};
  if (typeof fullName !== "string" || fullName.trim().length < 2 || typeof email !== "string" || !email.includes("@") || typeof password !== "string" || password.length < 8 || typeof geminiApiKey !== "string" || geminiApiKey.length < 10) {
    res.status(400).json({ error: "Enter your name, a valid email, a password of at least 8 characters, and your Gemini API key." });
    return;
  }
  if (findStudentByEmail(email)) {
    res.status(400).json({ error: "An account with that email already exists." });
    return;
  }
  const student = addStudent({ fullName: fullName.trim(), email: email.trim(), password, geminiApiKey });
  res.status(201).json({ token: createToken(student.id), student: studentView(student) });
});

router.post("/auth/login", (req, res): void => {
  const { email, password } = req.body ?? {};
  const student = typeof email === "string" ? findStudentByEmail(email) : undefined;
  if (!student || typeof password !== "string" || !verifyPassword(student, password)) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  res.json({ token: createToken(student.id), student: studentView(student) });
});

router.get("/auth/me", requireAuth, (req: AuthenticatedRequest, res): void => {
  const student = getStudent(req.studentId!);
  res.json(studentView(student!));
});

router.patch("/auth/gemini-key", requireAuth, (req: AuthenticatedRequest, res): void => {
  const key = req.body?.geminiApiKey;
  if (typeof key !== "string" || key.length < 10) {
    res.status(400).json({ error: "Enter a valid Gemini API key." });
    return;
  }
  res.json(studentView(updateStudentGeminiKey(req.studentId!, key)!));
});

export default router;