import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export type MaterialStatus =
  | "uploaded"
  | "validating"
  | "extracting"
  | "generating"
  | "ready"
  | "failed";
export type FailureType =
  | "scanned_pdf"
  | "course_limit_exceeded"
  | "generation_error"
  | "quota_exhausted"
  | null;

export type Student = {
  id: string;
  fullName: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  encryptedGeminiKey: string;
};
export type Course = {
  id: string;
  studentId: string;
  title: string;
  description: string;
  totalPageCount: number;
  createdAt: Date;
};
export type Material = {
  id: string;
  courseId: string;
  originalFileName: string;
  pageCount: number;
  extractedCharCount: number;
  extractedText: string;
  status: MaterialStatus;
  failureType: FailureType;
  failureReason: string | null;
  flashcardCount: number;
  questionCount: number;
  createdAt: Date;
};
export type Flashcard = {
  id: string;
  materialId: string;
  courseId: string;
  front: string;
  back: string;
};
export type TestQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};
export type MaterialTest = {
  id: string;
  materialId: string;
  courseId: string;
  materialName: string;
  questions: TestQuestion[];
};
export type TestAttempt = {
  id: string;
  studentId: string;
  testId: string;
  materialName: string;
  answers: number[];
  score: number;
  totalQuestions: number;
  takenAt: Date;
};

const students = new Map<string, Student>();
const courses = new Map<string, Course>();
const materials = new Map<string, Material>();
const flashcards = new Map<string, Flashcard>();
const tests = new Map<string, MaterialTest>();
const attempts = new Map<string, TestAttempt>();

const secret = process.env.SESSION_SECRET ?? "asr-development-secret";
const encryptionKey = createHash("sha256").update(secret).digest();

export function createPassword(password: string): Pick<Student, "passwordHash" | "passwordSalt"> {
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, passwordSalt, 64).toString("hex");
  return { passwordHash, passwordSalt };
}

export function verifyPassword(student: Student, password: string): boolean {
  const actual = scryptSync(password, student.passwordSalt, 64);
  const expected = Buffer.from(student.passwordHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function encryptGeminiKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptGeminiKey(value: string): string {
  const [ivHex, tagHex, encryptedHex] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function createToken(studentId: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: studentId, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    return parsed.exp && parsed.exp > Date.now() && parsed.sub ? parsed.sub : null;
  } catch {
    return null;
  }
}

export function studentView(student: Student) {
  return { id: student.id, fullName: student.fullName, email: student.email, hasGeminiKey: Boolean(student.encryptedGeminiKey) };
}

export function findStudentByEmail(email: string) {
  return [...students.values()].find((student) => student.email.toLowerCase() === email.toLowerCase());
}

export function getStudent(id: string) {
  return students.get(id);
}

export function addStudent(input: { fullName: string; email: string; password: string; geminiApiKey: string }) {
  const password = createPassword(input.password);
  const student: Student = {
    id: randomUUID(),
    fullName: input.fullName,
    email: input.email.toLowerCase(),
    ...password,
    encryptedGeminiKey: encryptGeminiKey(input.geminiApiKey),
  };
  students.set(student.id, student);
  return student;
}

export function updateStudentGeminiKey(studentId: string, key: string) {
  const student = students.get(studentId);
  if (!student) return null;
  student.encryptedGeminiKey = encryptGeminiKey(key);
  return student;
}

export function listStudentCourses(studentId: string) {
  return [...courses.values()].filter((course) => course.studentId === studentId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function addCourse(studentId: string, title: string, description = "") {
  const course: Course = { id: randomUUID(), studentId, title, description, totalPageCount: 0, createdAt: new Date() };
  courses.set(course.id, course);
  return course;
}

export function updateCourse(courseId: string, input: { title: string; description: string }) {
  const course = courses.get(courseId);
  if (!course) return null;
  course.title = input.title;
  course.description = input.description;
  return course;
}

export function getCourseForStudent(courseId: string, studentId: string) {
  const course = courses.get(courseId);
  return course?.studentId === studentId ? course : null;
}

export function removeCourse(courseId: string) {
  for (const material of [...materials.values()]) if (material.courseId === courseId) removeMaterial(material.id);
  courses.delete(courseId);
}

export function listCourseMaterials(courseId: string) {
  return [...materials.values()].filter((material) => material.courseId === courseId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function getMaterial(materialId: string) {
  return materials.get(materialId);
}

export function getMaterialForStudent(materialId: string, studentId: string) {
  const material = materials.get(materialId);
  return material && getCourseForStudent(material.courseId, studentId) ? material : null;
}

export function addMaterial(input: Omit<Material, "id" | "createdAt">) {
  const material: Material = { ...input, id: randomUUID(), createdAt: new Date() };
  materials.set(material.id, material);
  return material;
}

export function removeMaterial(materialId: string) {
  const material = materials.get(materialId);
  if (!material) return;
  const course = courses.get(material.courseId);
  if (course && material.status !== "failed") course.totalPageCount = Math.max(0, course.totalPageCount - material.pageCount);
  for (const card of [...flashcards.values()]) if (card.materialId === materialId) flashcards.delete(card.id);
  for (const test of [...tests.values()]) if (test.materialId === materialId) tests.delete(test.id);
  materials.delete(materialId);
}

export function addFlashcards(items: Array<Omit<Flashcard, "id">>) {
  return items.map((item) => {
    const card = { ...item, id: randomUUID() };
    flashcards.set(card.id, card);
    return card;
  });
}

export function listCourseFlashcards(courseId: string) {
  return [...flashcards.values()].filter((card) => card.courseId === courseId);
}

export function addTest(input: Omit<MaterialTest, "id">) {
  const test = { ...input, id: randomUUID() };
  tests.set(test.id, test);
  return test;
}

export function getTest(testId: string) {
  return tests.get(testId);
}

export function getTestByMaterial(materialId: string) {
  return [...tests.values()].find((test) => test.materialId === materialId);
}

export function addAttempt(input: Omit<TestAttempt, "id" | "takenAt">) {
  const attempt = { ...input, id: randomUUID(), takenAt: new Date() };
  attempts.set(attempt.id, attempt);
  return attempt;
}

export function listStudentAttempts(studentId: string) {
  return [...attempts.values()].filter((attempt) => attempt.studentId === studentId).sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
}

export function courseSummary(course: Course) {
  const courseMaterials = listCourseMaterials(course.id);
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    totalPageCount: course.totalPageCount,
    materialCount: courseMaterials.length,
    readyMaterialCount: courseMaterials.filter((material) => material.status === "ready").length,
    createdAt: course.createdAt,
  };
}

export function materialView(material: Material) {
  return {
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
  };
}