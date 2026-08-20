interface Props {
  current: number;
  total: number;
  typeLabel: string;
  pendingRetests: number;
  onPause: () => void;
  onExit: () => void;
}

export function ProgressHeader({
  current,
  total,
  typeLabel,
  pendingRetests,
  onPause,
  onExit
}: Props) {
  return (
    <header className="progress-header">
      <div className="progress-header-left">
        <span className="progress-count">
          {current} / {total}
        </span>
        <span className="badge badge-type">{typeLabel}</span>
        {pendingRetests > 0 && (
          <span className="badge badge-retest">再テスト待ち {pendingRetests}</span>
        )}
      </div>
      <div className="progress-header-right">
        <button className="btn btn-ghost btn-small" onClick={onPause} aria-label="一時停止">
          ⏸ 中断
        </button>
        <button className="btn btn-ghost btn-small" onClick={onExit} aria-label="終了">
          終了
        </button>
      </div>
    </header>
  );
}
