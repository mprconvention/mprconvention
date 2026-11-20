import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { auditFields, type RecordAudit } from "../lib/recordAudit";

type Props = {
  title: string;
  fields: [label: string, value: string][];
  notes: string | null;
  audit: RecordAudit;
  onClose: () => void;
};

export function BookingDetails({ title, fields, notes, audit, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} className="master-modal booking-detail-dialog"
      aria-labelledby={titleId} onClose={onClose}>
      <div className="master-modal-head">
        <h2 id={titleId}>{title}</h2>
        <form method="dialog">
          <button className="icon-btn" aria-label="Close booking details" type="submit" autoFocus>
            <X size={18}/>
          </button>
        </form>
      </div>

      <dl className="booking-detail-fields">
        {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {notes && <section className="booking-detail-notes">
        <h3>Notes</h3>
        <p>{notes}</p>
      </section>}
      <section className="booking-detail-audit">
        <h3>Record audit (IST)</h3>
        <dl className="booking-detail-fields">
          {auditFields(audit).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>
    </dialog>
  );
}
