import { useState, type ReactNode } from 'react';
import { Button, Modal } from './primitives';
import { fieldError, input, label as labelCls } from './cls';

interface ReasonDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  minLength?: number;
  optional?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  children?: ReactNode;
}

export function ReasonDialog({ open, title, subtitle, ...form }: ReasonDialogProps) {
  return (
    <Modal open={open} onClose={form.onClose} title={title} subtitle={subtitle}>
      <ReasonForm {...form} />
    </Modal>
  );
}

function ReasonForm({
  label = 'Reason',
  placeholder,
  confirmLabel,
  danger,
  busy,
  minLength = 3,
  optional,
  onConfirm,
  onClose,
  children,
}: Omit<ReasonDialogProps, 'open' | 'title' | 'subtitle'>) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = !optional && reason.trim().length < minLength;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!tooShort) onConfirm(reason.trim());
      }}
    >
      {children}
      <label className="flex flex-col gap-1.5">
        <span className={labelCls}>
          {label}
          {optional ? ' (optional)' : ''}
        </span>
        <textarea
          className={`${input} min-h-20 resize-y`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
          maxLength={300}
          aria-invalid={touched && tooShort}
        />
        {touched && tooShort && (
          <span className={fieldError}>Please enter at least {minLength} characters.</span>
        )}
      </label>
      <div className="mt-5 flex justify-end gap-2.5">
        <Button type="button" variant="ghost" onClick={onClose}>
          Back
        </Button>
        <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}
