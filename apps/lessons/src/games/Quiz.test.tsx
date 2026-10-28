import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Quiz } from './Quiz';
import type { ResolvedQuiz } from '../content/lesson-content';

const quiz: ResolvedQuiz[] = [
  { id: 'q1', question: 'ما أول آية؟', prompt: null, word: null, options: ['أحد اثنان', 'أربعة خمسة'], answer: 0 },
  { id: 'q2', question: 'أكمل', prompt: 'ستة سبعة', word: null, options: ['ثمانية', 'أحد'], answer: 0 },
  { id: 'q3', question: 'ما معنى كلمة', prompt: null, word: 'ثلاثة', options: ['أ', 'ب'], answer: 1 },
];
const options = () => within(screen.getByRole('group', { name: 'الاختيارات' })).getAllByRole('button');

describe('the quiz', () => {
  it('asks each question once, with its prompt or word from the verified text, and scores the answers', () => {
    const done = vi.fn();
    render(<Quiz quiz={quiz} seed={1} onComplete={done} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('ما أول آية؟');
    fireEvent.click(screen.getByRole('button', { name: 'أحد اثنان' }));
    expect(screen.getByRole('status').textContent).toMatch(/أحسنت/);
    // One answer per question: the options lock.
    expect(options().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(screen.getByTestId('quiz-prompt').textContent).toBe('ستة سبعة …');
    fireEvent.click(screen.getByRole('button', { name: 'أحد' }));
    expect(screen.getByRole('status').textContent).toMatch(/الإجابة الصحيحة: ثمانية/);
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(screen.getByTestId('quiz-word').textContent).toBe('ثلاثة');
    fireEvent.click(screen.getByRole('button', { name: 'ب' }));
    fireEvent.click(screen.getByRole('button', { name: 'النتيجة' }));
    expect(screen.getByRole('status').textContent).toMatch(/٢ من ٣/);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('shuffles the options per visit, from its seed', () => {
    const orders = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { unmount } = render(<Quiz quiz={[{ ...quiz[0]!, options: ['أ', 'ب', 'ت', 'ث'] }]} seed={seed} onComplete={() => {}} />);
      orders.add(options().map((b) => b.textContent).join(','));
      unmount();
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});
