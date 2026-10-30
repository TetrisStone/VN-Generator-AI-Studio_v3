# default-project

This folder holds your **default VN-Studio project bundle** for the first start
of this game (`App.tsx` auto-imports it when the local IndexedDB is empty).

- **Local dev copy:** drop any project ZIP exported via *Editor → Export →
  Medien einschließen* here under the exact name `vn-project-default.zip`
  (served from `public/`, so it works offline). This file is **gitignored**
  because GitHub rejects files >100 MB in normal git.
- **Shared default for everyone cloning the repo:** upload the same ZIP as a
  release asset on GitHub:

  1. Open <https://github.com/TetrisStone/VN-Generator-AI-Studio_v3/releases>
  2. Create a new release with the tag **`default-project`**
     (title e.g. "Default Project Bundle", no code needs to be attached)
  3. Drag & drop your project ZIP onto the attach-files area and RENAME the
     upload to **`vn-project-default.zip`** (this name is part of the URL the
     game fetches on first start)
  4. Publish the release when the ~1.8 GB upload has finished.

  To ship a newer default later: edit the release, delete the old asset,
  upload the fresh ZIP under the same name — no repo change needed.
