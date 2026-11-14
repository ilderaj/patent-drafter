/**
 * The settings route, split into its own chunk. `AppearanceProvider` stays in
 * the root because it applies the saved theme to every page; the recovery
 * panel is only needed on this route.
 */
import { AppearancePage } from "../features/settings/Appearance.tsx";
import { Recovery } from "../features/recovery/Recovery.tsx";
import { LOCAL_ACTOR } from "./navigation.ts";
import type { LocalRepository } from "../lib/repository.ts";

export default function SettingsPage({ repository }: { repository: LocalRepository }) {
  return (
    <>
      <AppearancePage>
        <Recovery repository={repository} actor={LOCAL_ACTOR} />
      </AppearancePage>
    </>
  );
}
