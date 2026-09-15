import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";

const configured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
);

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

export function cloudinaryConfigured(): boolean {
  return configured;
}

export function uploadPdfBuffer(
  buffer: Buffer,
): Promise<{ secureUrl: string; publicId: string }> {
  if (!configured) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }
  return new Promise((resolve, reject) => {
    const publicId = `asr/${randomUUID()}.pdf`;
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: publicId,
        use_filename: false,
        unique_filename: false,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(new Error(error?.message ?? "Cloudinary upload failed."));
          return;
        }
        let url = result.secure_url;
        if (!/\.pdf(\?|#|$)/i.test(url)) url = `${url}.pdf`;
        resolve({ secureUrl: url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

export async function destroyAsset(publicId: string): Promise<void> {
  if (!configured) return;
  await new Promise<void>((resolve, reject) => {
    cloudinary.uploader.destroy(publicId, { resource_type: "raw" }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}