"use client";

import { useEffect } from "react";
import { useProjectSection } from "@/components/project-section-context";

// Non-visual — tells the Sidebar which tab this project's detail page
// belongs to (see components/project-section-context.tsx), since the
// page itself already knows the project's is_recovery but the Sidebar
// (a sibling in the tree, not a descendant) doesn't. Clears the
// override on unmount so navigating away never leaves a stale value
// behind for whatever renders next.
export function SetProjectSection({ isRecovery }: { isRecovery: boolean }) {
  const { setSection } = useProjectSection();

  useEffect(() => {
    setSection(isRecovery ? "recovery" : "projects");
    return () => setSection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSection is a stable useState setter
  }, [isRecovery]);

  return null;
}
