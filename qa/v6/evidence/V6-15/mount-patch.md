# V6-15 mount patch (orchestrator-owned files)

The feature is self-contained in `apps/web/src/v6/features/ai/`. It is not reachable
from the shell until the two orchestrator-owned registration files below are
updated. These exact edits were applied temporarily only to drive the browser
evidence, then reverted byte for byte.

## 1. `apps/web/src/v6/routes/V6App.tsx`

Add the import after the existing `Figures` import (line 15):

```tsx
import { AiPage } from "../features/ai/Ai.tsx";
```

Replace the `section` case in `Page` (line 119-121 before the patch):

```tsx
    case "section":
      if (route.key === "ai") return <AiPage repository={repository} actor={LOCAL_ACTOR} />;
      return <SectionPage sectionKey={route.key} />;
```

`LOCAL_ACTOR` is already imported by this file. No other change is needed; the
`ai` route already parses as `{ kind: "section", key: "ai" }`.

## 2. `apps/web/src/v6/routes/navigation.ts`

Replace the AI entry in `GLOBAL_NAV` (line 95):

```ts
  { key: "ai", label: "AI 与数据", capability: AVAILABLE },
```

The previous unavailable reason was
`"AI 设置尚未开放：本地版目前不调用任何模型。"`. The component itself still
reports the closed real-outbound gate (`RELEASE_GATE_CLOSED`) and never claims a
local model exists.

## Application and revert

Apply the two edits above. For the evidence run they were applied to the
orchestrator files, built, exercised in Chromium, then reverted by removing the
import, restoring `return <SectionPage sectionKey={route.key} />;`, and restoring
the original AI entry line. No other file was changed.

Hashes observed while applying the patch:

| file | original (before and after revert) | with patch |
| --- | --- | --- |
| `apps/web/src/v6/routes/V6App.tsx` | `a00c9c0e62ac68ac9c796e8d1385aa8d2729dc99d092b3df0c0c2a8b087e18bf` | `12bc106552c7536a153713ddd8c0230993c1dd177644ef3e1e0891b7b8780657` |
| `apps/web/src/v6/routes/navigation.ts` | `578ccf038c0a64b94fd89d76f02e767fc3546934d905be70e23e5b98487e2144` | `a9bf925f77d7d1235f686d5f4dd43ee3c5a13e3bd38cdebfbb1a93f6c5dc854b` |

The patched build is `build-mounted.txt`; the final tree build is `build.txt`.
After the browser run, both files were restored from byte backups and their
hashes matched the original values above. `git status` then listed neither file.
