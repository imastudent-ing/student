import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import { CsvImportPanel } from '../components/CsvImportPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { getAllWords, resetAllHistory, deleteAllData } from '../db/repositories';
import { wordsToCsv } from '../importExport/csvExport';
import { createBackupJson, downloadFile, restoreFromJson } from '../importExport/jsonBackup';
import { getEnglishVoices, onVoicesChanged, resolveVoice, speakWord } from '../audio/speech';
import { todayStr } from '../utils/dates';
import type { AppSettings } from '../domain/types';

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const showToast = useUiStore((s) => s.showToast);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => getEnglishVoices());

  // iOS Safari では音声リストが遅れて読み込まれるため監視する
  useEffect(() => {
    setVoices(getEnglishVoices());
    return onVoicesChanged(() => setVoices(getEnglishVoices()));
  }, []);

  const autoVoice = resolveVoice(settings);

  const num = (key: keyof AppSettings, min: number, max: number) => ({
    type: 'number' as const,
    className: 'input input-number',
    min,
    max,
    value: Number(settings[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (!Number.isNaN(v) && v >= min && v <= max) void update({ [key]: v });
    }
  });

  const toggle = (key: keyof AppSettings) => ({
    type: 'checkbox' as const,
    checked: Boolean(settings[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void update({ [key]: e.target.checked })
  });

  return (
    <div className="page">
      <h1 className="page-title">設定</h1>

      <section className="card">
        <h2>学習設定</h2>
        <label className="setting-row">
          1日の基本語数
          <input {...num('dailyTarget', 10, 500)} />
        </label>
        <label className="setting-row">
          抜き打ち語数
          <input {...num('auditTarget', 0, 100)} />
        </label>
        <label className="setting-row">
          即答制限時間（秒）
          <input
            type="number"
            className="input input-number"
            min={2}
            max={5}
            step={0.5}
            value={settings.fastThresholdMs / 1000}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 2 && v <= 5) void update({ fastThresholdMs: Math.round(v * 1000) });
            }}
          />
        </label>
        <label className="setting-row">
          再テスト間隔（最小・語数）
          <input {...num('retestGapMin', 1, 50)} />
        </label>
        <label className="setting-row">
          再テスト間隔（最大・語数）
          <input {...num('retestGapMax', 1, 50)} />
        </label>
        <label className="setting-row">
          再テスト最大回数
          <input {...num('maxSameDayRetests', 1, 10)} />
        </label>
        <label className="setting-row">
          弱点卒業に必要な別日成功数
          <input {...num('graduationSuccessCount', 1, 10)} />
        </label>
        <label className="setting-row">
          1回成功後の間隔（日）
          <input {...num('intervalAfterFirstSuccessDays', 1, 30)} />
        </label>
        <label className="setting-row">
          2回成功後の間隔（日）
          <input {...num('intervalAfterSecondSuccessDays', 1, 60)} />
        </label>
        <label className="setting-row">
          抜き打ち最短間隔（日）
          <input {...num('masteredAuditMinimumDays', 1, 120)} />
        </label>
        <label className="setting-row">
          シャッフル
          <input {...toggle('shuffleEnabled')} />
        </label>
        <label className="setting-row">
          自動で次へ進む
          <input {...toggle('autoAdvance')} />
        </label>
      </section>

      <section className="card">
        <h2>表示設定</h2>
        <label className="setting-row">
          テーマ
          <select
            className="input"
            value={settings.theme}
            onChange={(e) => void update({ theme: e.target.value as AppSettings['theme'] })}
          >
            <option value="system">端末に合わせる</option>
            <option value="light">ライト</option>
            <option value="dark">ダーク</option>
          </select>
        </label>
        <label className="setting-row">
          文字サイズ
          <select
            className="input"
            value={settings.fontScale}
            onChange={(e) => void update({ fontScale: e.target.value as AppSettings['fontScale'] })}
          >
            <option value="small">小</option>
            <option value="medium">中</option>
            <option value="large">大</option>
          </select>
        </label>
        <label className="setting-row">
          単語番号を表示
          <input {...toggle('showWordNumber')} />
        </label>
        <label className="setting-row">
          フレーズを表示
          <input {...toggle('showPhrase')} />
        </label>
        <label className="setting-row">
          経過秒数を表示
          <input {...toggle('showTimer')} />
        </label>
      </section>

      <section className="card">
        <h2>音声設定</h2>
        <label className="setting-row">
          ブラウザ読み上げを使う
          <input {...toggle('speechEnabled')} />
        </label>
        <label className="setting-row">
          答え表示時に自動再生
          <input {...toggle('autoPlayAudio')} />
        </label>
        <label className="setting-row">
          読み方不明時に自動再生
          <input {...toggle('autoPlayPronunciationIssue')} />
        </label>
        <label className="setting-row">
          登録音声を優先
          <input {...toggle('preferRegisteredAudio')} />
        </label>
        <label className="setting-row">
          再生速度
          <input
            type="number"
            className="input input-number"
            min={0.5}
            max={2}
            step={0.1}
            value={settings.speechRate}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 0.5 && v <= 2) void update({ speechRate: v });
            }}
          />
        </label>
        <label className="setting-row">
          音量
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={settings.speechVolume}
            onChange={(e) => void update({ speechVolume: Number(e.target.value) })}
          />
        </label>
        {voices.length > 0 ? (
          <label className="setting-row">
            音声
            <select
              className="input"
              value={settings.speechVoiceURI ?? ''}
              onChange={(e) => void update({ speechVoiceURI: e.target.value || null })}
            >
              <option value="">
                自動選択{autoVoice ? `（${autoVoice.name}）` : ''}
              </option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}（{v.lang}）
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="hint">
            英語音声が見つかりません。一度「試聴」を押すと読み込まれる場合があります。
          </p>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => {
            if (!speakWord('vocabulary', settings)) {
              showToast('音声を再生できませんでした。', 'error');
            }
          }}
        >
          🔊 試聴（vocabulary）
        </button>
        <p className="hint">
          発音が機械的な場合は、上のリストから「Enhanced / Premium」付きの音声を選んでください。
          iPhoneでは「設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 英語」から
          高品質な音声（SamanthaのEnhanced版やSiriの声など）を無料でダウンロードでき、
          追加するとこのアプリでも選べるようになります。再生速度を0.8〜0.9にすると聞き取りやすくなります。
        </p>
      </section>

      <section className="card">
        <h2>データ設定</h2>
        <h3>CSVインポート</h3>
        <CsvImportPanel />
        <h3>エクスポート・バックアップ</h3>
        <div className="detail-actions">
          <button
            className="btn btn-secondary"
            onClick={() => {
              void getAllWords().then((words) => {
                downloadFile(`vocab-${todayStr()}.csv`, wordsToCsv(words), 'text/csv');
              });
            }}
          >
            CSVエクスポート
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              void createBackupJson().then((json) => {
                downloadFile(`vocab-backup-${todayStr()}.json`, json, 'application/json');
              });
            }}
          >
            JSONバックアップ
          </button>
        </div>
        <h3>JSON復元</h3>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="バックアップJSONを選択"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void file
              .text()
              .then(restoreFromJson)
              .then(() => {
                showToast('復元しました。', 'success');
                navigate('/');
              })
              .catch((err: unknown) => {
                showToast(err instanceof Error ? err.message : '復元に失敗しました。', 'error');
              });
          }}
        />
        <h3>危険な操作</h3>
        <div className="detail-actions">
          <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>
            全履歴リセット
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDeleteAll(true)}>
            全データ削除
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmReset}
        title="全履歴リセット"
        message="すべての学習履歴・進捗を削除します。単語データは残ります。元に戻せません。"
        confirmLabel="リセットする"
        danger
        requireText="リセット"
        onConfirm={() => {
          setConfirmReset(false);
          void resetAllHistory().then(() => showToast('履歴をリセットしました。', 'success'));
        }}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmDeleteAll}
        title="全データ削除"
        message="単語・履歴・設定をすべて削除します。元に戻せません。"
        confirmLabel="すべて削除する"
        danger
        requireText="削除"
        onConfirm={() => {
          setConfirmDeleteAll(false);
          void deleteAllData().then(() => {
            showToast('すべてのデータを削除しました。');
            navigate('/onboarding');
          });
        }}
        onCancel={() => setConfirmDeleteAll(false)}
      />
    </div>
  );
}
