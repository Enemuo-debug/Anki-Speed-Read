---
name: ASR build boundaries
description: Durable choices around ASR's first runnable build and later integration work.
---

The current build keeps PDF processing and study state behind the API boundary. Gemini generation is live through the encrypted student key, while Cloudinary and durable external database persistence are not connected yet. The generated API schemas are the stable boundary for adding those providers later.

**Why:** The core product needed to be previewable and testable without waiting on external storage/database accounts, and the workspace already has PostgreSQL + Drizzle conventions that should be considered before introducing MongoDB.

**How to apply:** Preserve the current route and response contracts when replacing the in-memory store with durable persistence and adding a PDF object-storage adapter.