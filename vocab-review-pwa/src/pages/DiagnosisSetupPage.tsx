import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllWords } from '../db/repositories';
import type { DiagnosisConfig } from '../domain/queueBuilder';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';

const PRESETS: Array<{ label: string; config: Partial<DiagnosisConfig> }> = [
  { label: '未診断100語', config: { count: 100, unassessedOnly: true, order: 'sequential' } },
  { label: '未診断200語', config: { count: 200, unassessedOnly: true, order: 'sequential' } },
  { label: '1〜800', config: { startNumber: 1, endNumber: 800, count: 800, order: 'sequential' } },
  {
    label: '801〜1500',
    config: { startNumber: 801, endNumber: 1500, count: 700, order: 'sequential' }
  },
  {
    label: '1501〜1900',
    config: { startNumber: 1501, endNumber: 1900, count: 400, order: 'sequential' }
  },
  { label: '全範囲ランダム100語', config: { count: 100, order: 'random' } }
];

export function DiagnosisSetupPage() {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const startDiagnosis = useSessionStore((s) => s.startDiagnosisSession);
  const [maxNumber, setMaxNumber] = useState(1900);
  const [config, setConfig] = useState<DiagnosisConfig>({
    startNumber: 1,
    endNumber: 1900,
    count: 100,
    order: 'random',
    unassessedOnly: false,
    excludeWeak: false,
    excludeMastered: false
  });
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void getAllWords().then((words) => {
      const max = words.reduce((m, w) => Math.max(m, w.number), 0) || 1900;
      setMaxNumber(max);
      setConfig((c) => ({ ...c, endNumber: max }));
    });
  }, []);

  const start = async (override?: Partial<DiagnosisConfig>) => {
    setStarting(true);
    const finalConfig: DiagnosisConfig = {
      ...config,
      startNumber: 1,
      endNumber: maxNumber,
      ...override
    };
    const id = await startDiagnosis(override ? finalConfig : config);
    setStarting(false);
    if (id) navigate('/study');
    else showToast('条件に合う単語がありません。', 'error');
  };

  return (
    <div className="page">
      <h1 className="page-title">診断モード</h1>
      <p className="hint">
        全単語を一度判定して弱点を抽出します。即答は習得済み、遅答・不正解は弱点になります。
      </p>

      <section className="card">
        <h2>プリセット</h2>
        <div className="preset-buttons">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="btn btn-secondary"
              disabled={starting}
              onClick={() => void start(p.config)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>カスタム設定</h2>
        <div className="form-grid">
          <label>
            開始番号
            <input
              type="number"
              className="input"
              min={1}
              value={config.startNumber}
              onChange={(e) => setConfig({ ...config, startNumber: Number(e.target.value) })}
            />
          </label>
          <label>
            終了番号
            <input
              type="number"
              className="input"
              min={1}
              value={config.endNumber}
              onChange={(e) => setConfig({ ...config, endNumber: Number(e.target.value) })}
            />
          </label>
          <label>
            出題数
            <input
              type="number"
              className="input"
              min={1}
              value={config.count}
              onChange={(e) => setConfig({ ...config, count: Number(e.target.value) })}
            />
          </label>
          <label>
            出題順
            <select
              className="input"
              value={config.order}
              onChange={(e) =>
                setConfig({ ...config, order: e.target.value as 'sequential' | 'random' })
              }
            >
              <option value="sequential">番号順</option>
              <option value="random">ランダム</option>
            </select>
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={config.unassessedOnly}
            onChange={(e) => setConfig({ ...config, unassessedOnly: e.target.checked })}
          />
          未診断のみ
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={config.excludeWeak}
            onChange={(e) => setConfig({ ...config, excludeWeak: e.target.checked })}
          />
          弱点を除外する
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={config.excludeMastered}
            onChange={(e) => setConfig({ ...config, excludeMastered: e.target.checked })}
          />
          習得済みを除外する
        </label>
        <button
          className="btn btn-primary btn-big"
          disabled={starting}
          onClick={() => void start()}
        >
          診断を始める
        </button>
      </section>
    </div>
  );
}
