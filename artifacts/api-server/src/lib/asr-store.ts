import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose, { type HydratedDocument } from "mongoose";
import {
  CourseModel,
  FlashcardModel,
  MaterialModel,
  MaterialTestModel,
  StudentModel,
  TestAttemptModel,
  type CourseRecord,
  type MaterialRecord,
  type MaterialTestRecord,
  type FlashcardRecord,
  type StudentRecord,
  type TestAttemptRecord,
} from "./models";
import { destroyAsset } from "./cloudinary";

export type MaterialStatus = "uploaded" | "validating" | "extracting" | "generating" | "ready" | "failed";
export type FailureType = "scanned_pdf" | "course_limit_exceeded" | "generation_error" | "quota_exhausted" | null;

export type Student = HydratedDocument<StudentRecord>;
export type Course = HydratedDocument<CourseRecord>;
export type Material = HydratedDocument<MaterialRecord>;
export type Flashcard = HydratedDocument<FlashcardRecord>;
export type MaterialTest = HydratedDocument<MaterialTestRecord>;
export type TestAttempt = HydratedDocument<TestAttemptRecord>;

function jwtSecret(): string {
  return process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "asr-development-secret";
}
function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(process.env.ENCRYPTION_KEY ?? process.env.SESSION_SECRET ?? "asr-development-secret")
    .digest();
}

function isValidId(value: string): boolean {
  return mongoose.isValidObjectId(value);
}

export async function createPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(student: Student, password: string): Promise<boolean> {
  return bcrypt.compare(password, student.passwordHash);
}

export function encryptGeminiKey(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${encrypted.toString("hex")}`;
}

export function decryptGeminiKey(value: string): string {
  const [ivHex, tagHex, encryptedHex] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function createToken(studentId: string): string {
  return jwt.sign({}, jwtSecret(), { subject: studentId, expiresIn: "14d" });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function studentView(student: Student) {
  return {
    id: student.id,
    fullName: student.fullName,
    email: student.email,
    hasGeminiKey: Boolean(student.encryptedGeminiKey),
  };
}

export async function findStudentByEmail(email: string): Promise<Student | null> {
  return StudentModel.findOne({ email: email.toLowerCase() }).exec();
}

export async function getStudent(id: string): Promise<Student | null> {
  if (!isValidId(id)) return null;
  return StudentModel.findById(id).exec();
}

export async function addStudent(input: { fullName: string; email: string; password: string; geminiApiKey: string }): Promise<Student> {
  const passwordHash = await createPassword(input.password);
  const student = await StudentModel.create({
    fullName: input.fullName,
    email: input.email.toLowerCase(),
    passwordHash,
    encryptedGeminiKey: encryptGeminiKey(input.geminiApiKey),
  });
  return student;
}

export async function updateStudentGeminiKey(studentId: string, key: string): Promise<Student | null> {
  if (!isValidId(studentId)) return null;
  const student = await StudentModel.findById(studentId).exec();
  if (!student) return null;
  student.encryptedGeminiKey = encryptGeminiKey(key);
  await student.save();
  return student;
}

export async function listStudentCourses(studentId: string): Promise<Course[]> {
  return CourseModel.find({ student: studentId }).sort({ createdAt: -1 }).exec();
}

export async function addCourse(studentId: string, title: string, description = ""): Promise<Course> {
  return CourseModel.create({ student: studentId, title, description, totalPageCount: 0 });
}

export async function updateCourse(courseId: string, input: { title: string; description: string }): Promise<Course | null> {
  if (!isValidId(courseId)) return null;
  const course = await CourseModel.findById(courseId).exec();
  if (!course) return null;
  course.title = input.title;
  course.description = input.description;
  await course.save();
  return course;
}

export async function getCourseForStudent(courseId: string, studentId: string): Promise<Course | null> {
  if (!isValidId(courseId)) return null;
  return CourseModel.findOne({ _id: courseId, student: studentId }).exec();
}

export async function adjustCoursePages(courseId: string, delta: number): Promise<void> {
  if (!isValidId(courseId)) return;
  await CourseModel.updateOne({ _id: courseId }, { $inc: { totalPageCount: delta } }).exec();
}

export async function removeCourse(courseId: string): Promise<void> {
  const materials = await MaterialModel.find({ course: courseId }).select("_id").exec();
  for (const material of materials) {
    await removeMaterial(material._id.toString());
  }
  await CourseModel.deleteOne({ _id: courseId }).exec();
}

export async function listCourseMaterials(courseId: string): Promise<Material[]> {
  return MaterialModel.find({ course: courseId }).sort({ createdAt: 1, _id: 1 }).exec();
}

export async function getMaterial(materialId: string): Promise<Material | null> {
  if (!isValidId(materialId)) return null;
  return MaterialModel.findById(materialId).exec();
}

export async function getMaterialForStudent(materialId: string, studentId: string): Promise<Material | null> {
  if (!isValidId(materialId)) return null;
  const material = await MaterialModel.findById(materialId).exec();
  if (!material) return null;
  const owned = await CourseModel.exists({ _id: material.course, student: studentId }).exec();
  return owned ? material : null;
}

export async function addMaterial(input: Omit<MaterialRecord, "course" | "cloudinaryUrl" | "cloudinaryPublicId" | "createdAt"> & { courseId: string; cloudinaryUrl?: string | null; cloudinaryPublicId?: string | null }): Promise<Material> {
  return MaterialModel.create({
    course: input.courseId,
    originalFileName: input.originalFileName,
    cloudinaryUrl: input.cloudinaryUrl ?? null,
    cloudinaryPublicId: input.cloudinaryPublicId ?? null,
    pageCount: input.pageCount,
    extractedCharCount: input.extractedCharCount,
    extractedText: input.extractedText,
    status: input.status,
    failureType: input.failureType ?? null,
    failureReason: input.failureReason ?? null,
    flashcardCount: input.flashcardCount ?? 0,
    questionCount: input.questionCount ?? 0,
  });
}

export async function removeMaterial(materialId: string): Promise<void> {
  if (!isValidId(materialId)) return;
  const material = await MaterialModel.findById(materialId).exec();
  if (!material) return;

  const course = await CourseModel.findById(material.course).exec();
  if (course && material.status !== "failed") {
    await adjustCoursePages(course._id.toString(), -material.pageCount);
  }
  if (material.cloudinaryPublicId) {
    await destroyAsset(material.cloudinaryPublicId).catch(() => undefined);
  }
  const tests = await MaterialTestModel.find({ material: material._id }).select("_id").exec();
  const testIds = tests.map((test) => test._id);
  if (testIds.length > 0) {
    await TestAttemptModel.deleteMany({ test: { $in: testIds } }).exec();
  }
  await FlashcardModel.deleteMany({ material: material._id }).exec();
  await MaterialTestModel.deleteMany({ material: material._id }).exec();
  await material.deleteOne();
}

export async function addFlashcards(items: Array<{ materialId: string; courseId: string; front: string; back: string }>): Promise<Flashcard[]> {
  if (items.length === 0) return [];
  return FlashcardModel.insertMany(
    items.map((item) => ({
      material: new mongoose.Types.ObjectId(item.materialId),
      course: new mongoose.Types.ObjectId(item.courseId),
      front: item.front,
      back: item.back,
    })),
  );
}

export async function listCourseFlashcards(courseId: string) {
  return FlashcardModel.find({ course: courseId })
    .sort({ createdAt: 1, _id: 1 })
    .exec()
    .then((cards) =>
      cards.map((card) => ({
        id: card.id,
        materialId: card.material.toString(),
        courseId: card.course.toString(),
        front: card.front,
        back: card.back,
      })),
    );
}

export async function addTest(input: { materialId: string; courseId: string; materialName: string; questions: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }> }): Promise<MaterialTest> {
  return MaterialTestModel.create({
    material: input.materialId,
    course: input.courseId,
    materialName: input.materialName,
    questions: input.questions,
  });
}

export function testView(test: MaterialTest) {
  return {
    id: test.id,
    materialId: test.material.toString(),
    courseId: test.course.toString(),
    materialName: test.materialName,
    questions: test.questions,
  };
}

export async function getTest(testId: string) {
  if (!isValidId(testId)) return null;
  const test = await MaterialTestModel.findById(testId).exec();
  return test ? testView(test) : null;
}

export async function getTestByMaterial(materialId: string) {
  if (!isValidId(materialId)) return null;
  const test = await MaterialTestModel.findOne({ material: materialId }).exec();
  return test ? testView(test) : null;
}

export function attemptView(attempt: TestAttempt) {
  return {
    id: attempt.id,
    testId: attempt.test.toString(),
    materialName: attempt.materialName,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
    takenAt: attempt.createdAt,
  };
}

export async function addAttempt(input: Omit<TestAttemptRecord, "test" | "student" | "createdAt"> & { testId: string; studentId: string }): Promise<ReturnType<typeof attemptView>> {
  const attempt = await TestAttemptModel.create({
    student: new mongoose.Types.ObjectId(input.studentId),
    test: new mongoose.Types.ObjectId(input.testId),
    materialName: input.materialName,
    answers: input.answers,
    score: input.score,
    totalQuestions: input.totalQuestions,
  });
  return attemptView(attempt);
}

export async function listStudentAttempts(studentId: string) {
  return TestAttemptModel.find({ student: studentId })
    .sort({ createdAt: -1, _id: -1 })
    .exec()
    .then((attempts) => attempts.map(attemptView));
}

export async function courseSummary(course: Course) {
  const [materialCount, readyMaterialCount] = await Promise.all([
    MaterialModel.countDocuments({ course: course._id }).exec(),
    MaterialModel.countDocuments({ course: course._id, status: "ready" }).exec(),
  ]);
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    totalPageCount: course.totalPageCount,
    materialCount,
    readyMaterialCount,
    createdAt: course.createdAt,
  };
}

export function materialView(material: Material) {
  return {
    id: material.id,
    courseId: material.course.toString(),
    originalFileName: material.originalFileName,
    cloudinaryUrl: material.cloudinaryUrl,
    cloudinaryPublicId: material.cloudinaryPublicId,
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