import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Everything a reviewer should know about what this demo is and isn't, in one
 * place — instead of disclaimers sprinkled under every heading.
 */
export default function AboutDemo({ open, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="about-dialog" onClose={onClose} aria-labelledby="about-title">
      <div className="about-dialog__header">
        <h2 id="about-title">About this demo</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <ul className="about-dialog__list">
        <li><strong>Synthetic data only.</strong> Every patient, visit, staff member, and stock level is made up. Nothing here is real patient data.</li>
        <li><strong>Not clinically validated.</strong> The medicine list, interaction table, dose ceilings, and Hindi/Tamil templates are a small hand-built set that still needs review by a clinician, a pharmacist, and native speakers.</li>
        <li><strong>The doctor decides.</strong> Warnings inform and never block. Nothing reaches the patient until the doctor approves and signs.</li>
        <li><strong>Where AI is used.</strong> Sarvam turns speech into text and text into voice notes. Gemini only sorts the doctor's dictation into boxes (copying their exact words, checked by the server) and rewords the doctor's advice note, with name and phone removed. Dose schedules and warning signs are fixed templates.</li>
        <li><strong>Mocked integrations.</strong> WhatsApp messages are queued but never sent; ABHA linkage is simulated.</li>
        <li><strong>Consultation timer.</strong> Demo instrumentation only, not a measured time saving.</li>
        <li><strong>Sign-in.</strong> Personal PINs for demo accounts; fingerprint verification is planned.</li>
      </ul>
    </dialog>
  );
}
