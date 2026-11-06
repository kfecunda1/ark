"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type ProjectSection = "projects" | "recovery" | null;

interface ProjectSectionContextValue {
  section: ProjectSection;
  setSection: (section: ProjectSection) => void;
}

const ProjectSectionContext = createContext<ProjectSectionContextValue>({
  section: null,
  setSection: () => {},
});

// /projects/[id] is the one URL for every project's detail page
// regardless of is_recovery (see AGENTS.md-style reasoning: Projects
// and Recovery Projects are the same `projects` table, just split by a
// column, not two tables) — so the Sidebar's own pathname-based "active"
// check (components/sidebar.tsx) can't tell which tab a given detail
// page belongs to on its own. This is the one piece of state that
// crosses that gap: a project detail page sets it (via
// components/projects/set-project-section.tsx) and the Sidebar reads
// it to override its default pathname match for exactly the Projects /
// Recovery Projects items. Provided once, high up, in components/app-
// shell.tsx — a sibling of the Sidebar and of every page's own content.
export function ProjectSectionProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<ProjectSection>(null);
  return <ProjectSectionContext.Provider value={{ section, setSection }}>{children}</ProjectSectionContext.Provider>;
}

export function useProjectSection() {
  return useContext(ProjectSectionContext);
}
