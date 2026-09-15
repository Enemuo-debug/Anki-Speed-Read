import mongoose, { Schema, model, type Model } from "mongoose";

export const MATERIAL_STATUSES = ["uploaded", "validating", "extracting", "generating", "ready", "failed"] as const;
export const FAILURE_TYPES = ["scanned_pdf", "course_limit_exceeded", "generation_error", "quota_exhausted", null] as const;
export const MAX_COURSE_PAGES = 30;

const timestamps = { createdAt: true, updatedAt: false } as const;

export interface StudentRecord {
  fullName: string;
  email: string;
  passwordHash: string;
  encryptedGeminiKey: string;
  createdAt: Date;
}

const studentSchema = new Schema<StudentRecord>(
  {
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    passwordHash: { type: String, required: true },
    encryptedGeminiKey: { type: String, required: true },
  },
  { versionKey: false, timestamps },
);

export interface CourseRecord {
  student: mongoose.Types.ObjectId;
  title: string;
  description: string;
  totalPageCount: number;
  createdAt: Date;
}

const courseSchema = new Schema<CourseRecord>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    totalPageCount: { type: Number, default: 0 },
  },
  { versionKey: false, timestamps },
);

export interface MaterialRecord {
  course: mongoose.Types.ObjectId;
  originalFileName: string;
  cloudinaryUrl: string | null;
  cloudinaryPublicId: string | null;
  pageCount: number;
  extractedCharCount: number;
  extractedText: string;
  status: (typeof MATERIAL_STATUSES)[number];
  failureType: (typeof FAILURE_TYPES)[number];
  failureReason: string | null;
  flashcardCount: number;
  questionCount: number;
  createdAt: Date;
}

const materialSchema = new Schema<MaterialRecord>(
  {
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    originalFileName: { type: String, required: true },
    cloudinaryUrl: { type: String, default: null },
    cloudinaryPublicId: { type: String, default: null },
    pageCount: { type: Number, default: 0 },
    extractedCharCount: { type: Number, default: 0 },
    extractedText: { type: String, default: "" },
    status: { type: String, enum: MATERIAL_STATUSES, default: "uploaded" },
    failureType: { type: String, enum: FAILURE_TYPES, default: null },
    failureReason: { type: String, default: null },
    flashcardCount: { type: Number, default: 0 },
    questionCount: { type: Number, default: 0 },
  },
  { versionKey: false, timestamps },
);

export interface FlashcardRecord {
  material: mongoose.Types.ObjectId;
  course: mongoose.Types.ObjectId;
  front: string;
  back: string;
  createdAt: Date;
}

const flashcardSchema = new Schema<FlashcardRecord>(
  {
    material: { type: Schema.Types.ObjectId, ref: "Material", required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    front: { type: String, required: true },
    back: { type: String, required: true },
  },
  { versionKey: false, timestamps },
);

export interface TestQuestionRecord {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface MaterialTestRecord {
  material: mongoose.Types.ObjectId;
  course: mongoose.Types.ObjectId;
  materialName: string;
  questions: TestQuestionRecord[];
  createdAt: Date;
}

const testQuestionSchema = new Schema<TestQuestionRecord>(
  {
    question: { type: String, required: true },
    options: { type: [String], required: true },
    correctIndex: { type: Number, required: true },
    explanation: { type: String, default: "" },
  },
  { _id: false },
);

const materialTestSchema = new Schema<MaterialTestRecord>(
  {
    material: { type: Schema.Types.ObjectId, ref: "Material", required: true, unique: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    materialName: { type: String, required: true },
    questions: { type: [testQuestionSchema], default: [] },
  },
  { versionKey: false, timestamps },
);

export interface TestAttemptRecord {
  student: mongoose.Types.ObjectId;
  test: mongoose.Types.ObjectId;
  materialName: string;
  answers: number[];
  score: number;
  totalQuestions: number;
  createdAt: Date;
}

const testAttemptSchema = new Schema<TestAttemptRecord>(
  {
    student: { type: Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    test: { type: Schema.Types.ObjectId, ref: "MaterialTest", required: true, index: true },
    materialName: { type: String, required: true },
    answers: { type: [Number], default: [] },
    score: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
  },
  { versionKey: false, timestamps },
);

export const StudentModel: Model<StudentRecord> = model<StudentRecord>("Student", studentSchema);
export const CourseModel: Model<CourseRecord> = model<CourseRecord>("Course", courseSchema);
export const MaterialModel: Model<MaterialRecord> = model<MaterialRecord>("Material", materialSchema);
export const FlashcardModel: Model<FlashcardRecord> = model<FlashcardRecord>("Flashcard", flashcardSchema);
export const MaterialTestModel: Model<MaterialTestRecord> = model<MaterialTestRecord>("MaterialTest", materialTestSchema);
export const TestAttemptModel: Model<TestAttemptRecord> = model<TestAttemptRecord>("TestAttempt", testAttemptSchema);

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI must be set to a MongoDB connection string.");
  }
  mongoose.set("bufferCommands", false);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8_000 });
  await Promise.allSettled([
    StudentModel.init(),
    CourseModel.init(),
    MaterialModel.init(),
    FlashcardModel.init(),
    MaterialTestModel.init(),
    TestAttemptModel.init(),
  ]);
}