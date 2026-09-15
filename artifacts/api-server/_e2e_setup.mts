import mongoose from "mongoose";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { encryptGeminiKey, createToken } from "./src/lib/asr-store.js";

// Suppress dotenv stdout noise
const origLog = console.log;
console.log = () => {};

const envPath = "/home/zurus06/Documents/Zurus06 Projects/Anki-Speed-Read/.env";
const dotenv = await import("dotenv");
dotenv.default.config({ path: envPath });

await mongoose.connect(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 10000 });
const Student = mongoose.model("Student");
await Student.deleteMany({ email: "e2etest@student.unn.edu.ng" });
const encKey = await encryptGeminiKey("FAKE_GEMINI_KEY_FOR_TESTING_123456");
const student = await Student.create({
  fullName: "E2E Tester",
  email: "e2etest@student.unn.edu.ng",
  passwordHash: "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy",
  encryptedGeminiKey: encKey,
});
const token = createToken(student.id);

const outFile = fileURLToPath(new URL("./_e2e_token.txt", import.meta.url));
fs.writeFileSync(outFile, token);
await mongoose.disconnect();
process.exit(0);