import { useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** 強い確認: この文字列の入力を要求する */
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  danger = false,
  requireText,
  onConfirm,
  onCancel
}: Props) {
  const [typed, setTyped] = useState('');
  if (!open) return null;
  const confirmDisabled = requireText !== undefined && typed !== requireText;
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2 className="dialog-title">{title}</h2>
        <p className="dialog-message">{message}</p>
        {requireText !== undefined && (
          <div className="dialog-require">
            <p>
              続行するには「<strong>{requireText}</strong>」と入力してください。
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="input"
              aria-label="確認テキスト"
            />
          </div>
        )}
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={() => { setTyped(''); onCancel(); }}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={confirmDisabled}
            onClick={() => {
              setTyped('');
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
