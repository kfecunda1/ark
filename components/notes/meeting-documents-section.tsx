import { ExternalLink, FileText, Film } from "lucide-react";
import { ProjectDocumentTypeBadge } from "@/components/projects/badges";
import { getDocumentKind } from "@/lib/storage";
import { catalogLabel, getDictionary, type Lang } from "@/lib/i18n";
import type { DocumentTypeRecord, NoteDocument } from "@/lib/types";

export interface NoteDocumentWithUrl extends NoteDocument {
  signedUrl: string | null;
}

interface MeetingDocumentsSectionProps {
  documents: NoteDocumentWithUrl[];
  documentTypes: DocumentTypeRecord[];
  lang?: Lang;
}

function DocumentIcon({ doc }: { doc: NoteDocumentWithUrl }) {
  if (doc.url) return <ExternalLink className="h-4 w-4 shrink-0 text-white/35" />;
  const kind = getDocumentKind(doc.file_name);
  if (kind === "image" && doc.signedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={doc.signedUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
    );
  }
  if (kind === "video") return <Film className="h-4 w-4 shrink-0 text-white/35" />;
  return <FileText className="h-4 w-4 shrink-0 text-white/35" />;
}

// Read-only — a meeting's attachments are only ever added at creation
// time (components/notes/meeting-form.tsx's own Documents section),
// same "create-time staging only" scope as Opportunities before it.
export function MeetingDocumentsSection({ documents, documentTypes, lang = "en" }: MeetingDocumentsSectionProps) {
  const t = getDictionary(lang);

  if (documents.length === 0) {
    return <p className="text-sm text-white/35">{t.meetingDetail.noAttachments}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {documents.map((doc) => {
        const kind = doc.url ? null : getDocumentKind(doc.file_name);
        const viewHref = doc.url ?? doc.signedUrl;
        const viewLabel = doc.url
          ? t.projectDocuments.openLink
          : kind === "heic"
            ? t.projectDocuments.download
            : t.projectDocuments.view;
        const docTypeRecord = documentTypes.find((dt) => dt.name === doc.document_type);
        const docTypeLabel = docTypeRecord ? catalogLabel(docTypeRecord, lang) : doc.document_type;

        return (
          <div
            key={doc.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <DocumentIcon doc={doc} />
              <div className="min-w-0">
                <p className="truncate text-sm text-white/85">{doc.file_name}</p>
                <div className="mt-0.5">
                  <ProjectDocumentTypeBadge type={doc.document_type} label={docTypeLabel} />
                </div>
              </div>
            </div>
            {viewHref ? (
              <a
                href={viewHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-white transition-colors duration-150 ease-out hover:bg-white/[0.08]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {viewLabel}
              </a>
            ) : (
              <span className="shrink-0 text-xs text-rose-300">{t.projectDocuments.noLink}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
