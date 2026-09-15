import { v2 as cloudinary } from "cloudinary";

const dotenv = await import("dotenv");
dotenv.default.config({ path: "/home/zurus06/Documents/Zurus06 Projects/Anki-Speed-Read/.env", quiet: true });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

try {
  const usage = await cloudinary.api.usage();
  console.log("USAGE OK: plan", usage.plan, "| resources", usage.resources);
} catch (e: any) {
  console.log("RAW ERROR:", JSON.stringify(e, Object.getOwnPropertyNames(e) , 2));
}
process.exit(0);