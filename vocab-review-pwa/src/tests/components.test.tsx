import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyCard } from '../components/StudyCard';
import { AnswerPanel } from '../components/AnswerPanel';
import type { Word } from '../domain/types';

const word: Word = {
  id: 'w1',
  number: 491,
  word: 'retain',
  meaning: '保持する',
  secondaryMeaning: '維持する',
  phrase: 'retain information',
  phraseMeaning: '情報を保持する',
  tags: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
};

describe('StudyCard', () => {
  it('答え表示前は単語のみ表示し、意味やフレーズを表示しない', () => {
    render(
      <StudyCard
        word={word}
        revealed={false}
        shownAtMs={Date.now()}
        pronunciationUnknown={false}
        onTogglePronunciationUnknown={() => {}}
      />
    );
    expect(screen.getByText('retain')).toBeInTheDocument();
    expect(screen.queryByText('保持する')).not.toBeInTheDocument();
    expect(screen.queryByText('retain information')).not.toBeInTheDocument();
  });

  it('読み方が分からないトグルが動作する', async () => {
    const toggle = vi.fn();
    render(
      <StudyCard
        word={word}
        revealed={false}
        shownAtMs={Date.now()}
        pronunciationUnknown={false}
        onTogglePronunciationUnknown={toggle}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: '読み方が分からない' }));
    expect(toggle).toHaveBeenCalled();
  });
});

describe('AnswerPanel', () => {
  it('答え表示後に意味と判定ボタンを表示する', () => {
    render(
      <AnswerPanel
        word={word}
        isRetest={false}
        judgedResult={null}
        elapsedMs={1500}
        pronunciationEmphasized={false}
        onJudge={() => {}}
        onNext={() => {}}
        onUndo={() => {}}
        canUndo={false}
        carryOverNotice={false}
      />
    );
    expect(screen.getByText('保持する')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⭕ 正解' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /曖昧/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /不正解/ })).toBeInTheDocument();
  });

  it('再テストでは曖昧ボタンを表示しない', () => {
    render(
      <AnswerPanel
        word={word}
        isRetest={true}
        judgedResult={null}
        elapsedMs={null}
        pronunciationEmphasized={false}
        onJudge={() => {}}
        onNext={() => {}}
        onUndo={() => {}}
        canUndo={false}
        carryOverNotice={false}
      />
    );
    expect(screen.queryByRole('button', { name: /曖昧/ })).not.toBeInTheDocument();
  });

  it('3回失敗時の持ち越しメッセージを表示する', () => {
    render(
      <AnswerPanel
        word={word}
        isRetest={true}
        judgedResult="wrong"
        elapsedMs={null}
        pronunciationEmphasized={false}
        onJudge={() => {}}
        onNext={() => {}}
        onUndo={() => {}}
        canUndo={false}
        carryOverNotice={true}
      />
    );
    expect(screen.getByText(/今日はまだ定着していません/)).toBeInTheDocument();
  });
});
