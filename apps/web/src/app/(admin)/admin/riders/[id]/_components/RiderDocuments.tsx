import { approveRiderDocumentAction, rejectRiderDocumentAction } from "@/app/actions/admin";
import type { RiderDocumentView } from "@/lib/admin/riders";
import { EmptyState } from "@kiakia/ui";
import { AdminActionForm } from "../../../../_components/AdminActionForm";
import { ConfirmedAction } from "../../../../_components/ConfirmedAction";
import { formatDateTime, humanize } from "../../../../_components/format";
import { StatusPill } from "../../../../_components/StatusPill";

export function RiderDocuments({ documents }: { documents: readonly RiderDocumentView[] }) {
  if (documents.length === 0) {
    return <EmptyState title="No documents uploaded" description="The rider has not submitted any KYC documents yet." />;
  }

  return (
    <ul className="flex flex-col gap-4">
      {documents.map((document) => (
        <li key={document.id} className="rounded-control border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">{humanize(document.docType)}</span>
              <StatusPill status={document.status} />
            </div>
            {document.signedUrl ? (
              <a
                href={document.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-brand-600 hover:underline"
              >
                Open document (link expires in 5 minutes)
              </a>
            ) : (
              <span className="text-sm text-danger">File missing from storage</span>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-muted">Updated {formatDateTime(document.updatedAt)}</p>
          {document.reviewNote && <p className="mt-1 text-sm text-ink-muted">Note to rider: {document.reviewNote}</p>}

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {document.status !== "approved" && (
              <ConfirmedAction action={approveRiderDocumentAction.bind(null, document.id)} submitLabel="Approve document" />
            )}
            {document.status !== "rejected" && (
              <AdminActionForm
                action={rejectRiderDocumentAction}
                submitLabel="Reject document"
                variant="danger"
                reason={{ name: "note", label: "Note to the rider", required: true }}
              >
                <input type="hidden" name="documentId" value={document.id} />
              </AdminActionForm>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
