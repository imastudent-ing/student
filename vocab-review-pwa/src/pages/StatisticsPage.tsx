import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAllAttempts, getAllProgress, getAllWords } from '../db/repositories';
import {
  dailyFirstAttemptStats,
  frequentlyWrongWords,
  rangeMasteryStats,
  type DailyStat,
  type RangeStat,
  type WrongRankEntry
} from '../domain/statistics';
import { addDaysStr, todayStr } from '../utils/dates';

export function StatisticsPage() {
  const [daily, setDaily] = useState<DailyStat[]>([]);
  const [wrongRank, setWrongRank] = useState<WrongRankEntry[]>([]);
  const [pronRank, setPronRank] = useState<WrongRankEntry[]>([]);
  const [ranges, setRanges] = useState<RangeStat[]>([]);
  const [counts, setCounts] = useState({ weak: 0, mastered: 0, overdue: 0 });
  const [weekStats, setWeekStats] = useState({ words: 0, days: 0 });

  useEffect(() => {
    void (async () => {
      const [attempts, words, progressList] = await Promise.all([
        getAllAttempts(),
        getAllWords(),
        getAllProgress()
      ]);
      const stats = dailyFirstAttemptStats(attempts);
      setDaily(stats.slice(-14));
      setWrongRank(frequentlyWrongWords(words, progressList, 10));
      const wordMap = new Map(words.map((w) => [w.id, w]));
      setPronRank(
        progressList
          .filter((p) => p.pronunciationState === 'needs_review')
          .map((p) => ({ word: wordMap.get(p.wordId), progress: p, wrongTotal: p.totalWrong }))
          .filter((e): e is WrongRankEntry => e.word !== undefined)
          .slice(0, 10)
      );
      const maxNum = words.reduce((m, w) => Math.max(m, w.number), 0);
      const rangeDefs =
        maxNum > 1500
          ? [
              { start: 1, end: 800 },
              { start: 801, end: 1500 },
              { start: 1501, end: maxNum }
            ]
          : [{ start: 1, end: Math.max(maxNum, 1) }];
      setRanges(rangeMasteryStats(words, progressList, rangeDefs));
      const today = todayStr();
      setCounts({
        weak: progressList.filter((p) => p.state === 'weak').length,
        mastered: progressList.filter((p) => p.state === 'mastered').length,
        overdue: progressList.filter(
          (p) => p.state === 'weak' && p.dueDate !== null && p.dueDate < today
        ).length
      });
      const weekAgo = addDaysStr(today, -6);
      const weekAttempts = attempts.filter(
        (a) => a.isFirstAttemptOfDay && a.localStudyDate >= weekAgo
      );
      setWeekStats({
        words: weekAttempts.length,
        days: new Set(weekAttempts.map((a) => a.localStudyDate)).size
      });
    })();
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">統計</h1>

      <div className="card">
        <h2>初回即答率の推移</h2>
        <p className="hint">最重要指標。答え確認後の正解率ではなく、その日最初の1回の成績です。</p>
        {daily.length === 0 ? (
          <p>まだ学習記録がありません。</p>
        ) : (
          <div className="chart">
            {daily.map((d) => (
              <div key={d.date} className="chart-col">
                <div className="chart-bar-area">
                  <div
                    className="chart-bar chart-bar-fast"
                    style={{ height: `${d.fastRate}%` }}
                    title={`${d.fastRate}%`}
                  />
                </div>
                <span className="chart-value">{d.fastRate}%</span>
                <span className="chart-label">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>日別の内訳</h2>
        <table className="stats-table">
          <thead>
            <tr>
              <th>日付</th>
              <th>即答</th>
              <th>遅答</th>
              <th>不正解</th>
              <th>即答率</th>
            </tr>
          </thead>
          <tbody>
            {[...daily].reverse().map((d) => (
              <tr key={d.date}>
                <td>{d.date.slice(5)}</td>
                <td>{d.fast}</td>
                <td>{d.slow}</td>
                <td>{d.wrong}</td>
                <td>{d.fastRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>現在の状況</h2>
        <div className="stat-row">
          <span>弱点単語</span>
          <strong>{counts.weak}語</strong>
        </div>
        <div className="stat-row">
          <span>習得済み</span>
          <strong>{counts.mastered}語</strong>
        </div>
        <div className="stat-row">
          <span>期限超過</span>
          <strong>{counts.overdue}語</strong>
        </div>
        <div className="stat-row">
          <span>直近7日の学習語数</span>
          <strong>{weekStats.words}語</strong>
        </div>
        <div className="stat-row">
          <span>直近7日の学習日数</span>
          <strong>{weekStats.days}日</strong>
        </div>
      </div>

      <div className="card">
        <h2>範囲別の定着率</h2>
        {ranges.map((r) => (
          <div key={r.label} className="range-stat">
            <div className="stat-row">
              <span>{r.label}</span>
              <strong>{r.masteredRate}%</strong>
            </div>
            <div className="range-bar">
              <div className="range-bar-fill" style={{ width: `${r.masteredRate}%` }} />
            </div>
            <p className="hint">
              習得{r.mastered} / 弱点{r.weak} / 未診断{r.unassessed}（全{r.total}語）
            </p>
          </div>
        ))}
      </div>

      {wrongRank.length > 0 && (
        <div className="card">
          <h2>頻繁に間違える単語</h2>
          <ol className="rank-list">
            {wrongRank.map((e) => (
              <li key={e.word.id}>
                <Link to={`/words/${e.word.id}`}>
                  {e.word.word} — {e.word.meaning}（{e.wrongTotal}回）
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}

      {pronRank.length > 0 && (
        <div className="card">
          <h2>発音確認が必要な単語</h2>
          <ol className="rank-list">
            {pronRank.map((e) => (
              <li key={e.word.id}>
                <Link to={`/words/${e.word.id}`}>
                  {e.word.word}
                  {e.word.pronunciation && ` [${e.word.pronunciation}]`}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
