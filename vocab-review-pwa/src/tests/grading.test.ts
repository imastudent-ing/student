import { describe, expect, it } from 'vitest';
import { gradeAttempt, gradeRetest } from '../domain/grading';

const THRESHOLD = 3000;

describe('初回回答の判定', () => {
  it('3秒以内の正解は fast_correct になる', () => {
    expect(gradeAttempt('correct', 2999, THRESHOLD)).toBe('fast_correct');
    expect(gradeAttempt('correct', 3000, THRESHOLD)).toBe('fast_correct');
  });

  it('3秒超の正解は slow_correct になる', () => {
    expect(gradeAttempt('correct', 3001, THRESHOLD)).toBe('slow_correct');
    expect(gradeAttempt('correct', 10000, THRESHOLD)).toBe('slow_correct');
  });

  it('曖昧は経過時間に関わらず slow_correct になる', () => {
    expect(gradeAttempt('ambiguous', 500, THRESHOLD)).toBe('slow_correct');
    expect(gradeAttempt('ambiguous', 9000, THRESHOLD)).toBe('slow_correct');
  });

  it('不正解は wrong になる', () => {
    expect(gradeAttempt('wrong', 1000, THRESHOLD)).toBe('wrong');
  });

  it('「分からない」は wrong になる', () => {
    expect(gradeAttempt('dont_know', null, THRESHOLD)).toBe('wrong');
  });

  it('制限時間の設定値が反映される', () => {
    expect(gradeAttempt('correct', 4000, 5000)).toBe('fast_correct');
    expect(gradeAttempt('correct', 4000, 2000)).toBe('slow_correct');
  });
});

describe('再テストの判定', () => {
  it('正解 / 不正解のみ', () => {
    expect(gradeRetest('correct')).toBe('fast_correct');
    expect(gradeRetest('wrong')).toBe('wrong');
  });
});
