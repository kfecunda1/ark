// Same styling as the inline "Archived" badge on the Project detail
// page header — shared here since Receivers and Contacts (people) now
// need the identical marker wherever an archived one still shows up
// (its own detail page, a list with "Show archived" on, or linked from
// an existing project/receiver that hasn't been unlinked).
export function ArchivedBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-xs font-medium text-white/50">
      Archived
    </span>
  );
}
