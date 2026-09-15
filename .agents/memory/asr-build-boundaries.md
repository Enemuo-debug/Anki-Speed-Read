---
name: ASR build boundaries
description: Durable choices around ASR's first runnable build and later integration work.
---

The first runnable build keeps PDF processing and study state behind the API boundary so the student workflow works before Cloudinary or Gemini account setup is connected. The encrypted Gemini-key contract and generated API schemas are already in place for swapping those providers in later.

**Why:** Third-party package installation was unavailable in the initial environment, while the core product needed to be previewable and testable without waiting on external accounts.

**How to apply:** Preserve the current route and response contracts when replacing the self-contained processor/store with persistent storage or live Gemini/Cloudinary adapters.