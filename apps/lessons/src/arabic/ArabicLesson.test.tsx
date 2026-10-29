import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ArabicLesson } from './ArabicLesson';
import { resolveArabicLesson } from './arabic-lesson';
import { harakatStandIn, pairStandIn, standIn } from '../test/arabic-stand-in';
import { App } from '../App';

describe('the Arabic letters lesson page', () => {
  it('shows nothing of a pending file, and nothing of a lesson without content', () => {
    const pending = standIn();
    pending.review.status = 'pending';
    const { unmount } = render(<ArabicLesson lesson={1} content={pending} />);
    expect(screen.getByRole('status').textContent).toBe('هذا الدرس قيد المراجعة.');
    expect(screen.queryByText('كِتَابْ')).toBeNull();
    unmount();
    // The real lesson 1 file is pending the Teachers department: its page shows nothing of it.
    const real = render(<App pathname="/lessons/arabic/lesson-1" />);
    expect(screen.getByRole('status').textContent).toBe('هذا الدرس قيد المراجعة.');
    real.unmount();
    render(<ArabicLesson lesson={1} content={null} />);
    expect(screen.getByRole('status').textContent).toBe('هذا الدرس قيد الإعداد.');
  });

  it('refuses a file that fails a proof', () => {
    const bad = standIn();
    bad.units[0]!.words.push({ id: 'alif-009', text: 'أَسَدْ', was: null, review: null });
    render(<ArabicLesson lesson={1} content={bad} />);
    expect(screen.getByRole('alert').textContent).toMatch(/تعذّر التحقق/);
  });

  it('files each example by where the letter really is, and never shows a flagged word', () => {
    render(<ArabicLesson lesson={1} content={standIn()} />);
    expect(screen.queryByTestId('examples-start')).toBeNull(); // no alif word starts with alif
    const middle = screen.getByTestId('examples-middle');
    expect(middle.textContent).toContain('كِتَابْ');
    expect([...middle.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['ا']);
    expect(screen.getByTestId('examples-end').textContent).toContain('عَصَا');
    expect(screen.queryByText(/بَابْ/)).toBeNull();
  });

  it('find the letter: only the piece that IS the letter counts', () => {
    render(<ArabicLesson lesson={1} content={standIn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'ء' })); // the hamza unit
    fireEvent.click(screen.getByRole('button', { name: 'اِبْحَثْ عَنِ الْحَرْفِ' }));
    const word = () => within(screen.getByRole('group', { name: 'الكلمة' }));
    fireEvent.click(word().getByRole('button', { name: 'سَ' }));
    expect(screen.getByRole('status').textContent).toBe('حَاوِلْ مَرَّةً أُخْرَى.');
    fireEvent.click(word().getByRole('button', { name: 'أَ' }));
    expect(screen.getByRole('status').textContent).toBe('أَحْسَنْتَ!');
  });

  it('pick the words: a hamza word is never "with alif"', () => {
    render(<ArabicLesson lesson={1} content={standIn()} shuffleSeed={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'اِخْتَرِ الْكَلِمَاتِ' }));
    const words = within(screen.getByRole('group', { name: 'الكلمات' })).getAllByRole('button').map((b) => b.textContent);
    expect(words).toEqual(expect.arrayContaining(['كِتَابْ', 'عَصَا']));
    for (const w of ['كِتَابْ', 'عَصَا']) fireEvent.click(screen.getByRole('button', { name: w }));
    fireEvent.click(screen.getByRole('button', { name: 'أَسَدْ' }));
    fireEvent.click(screen.getByRole('button', { name: 'تَحَقَّقْ' }));
    expect(screen.getByRole('status').textContent).toBe('لَيْسَ بَعْدُ، اُنْظُرْ مَرَّةً أُخْرَى.');
    fireEvent.click(screen.getByRole('button', { name: 'أَسَدْ' }));
    fireEvent.click(screen.getByRole('button', { name: 'تَحَقَّقْ' }));
    expect(screen.getByRole('status').textContent).toBe('أَحْسَنْتَ!');
    expect(screen.getByLabelText('النجوم').textContent).toBe('★☆☆☆');
  });

  it('the quiz asks the proved questions of the chosen unit, and earns its star once', () => {
    render(<ArabicLesson lesson={1} content={standIn()} shuffleSeed={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'الِاخْتِبَارُ' }));
    // The alif unit's quiz: its one shown question, then its result.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('أَيُّ كَلِمَةٍ فِيهَا حَرْفُ «أَلِفْ»؟');
    fireEvent.click(screen.getByRole('button', { name: 'كِتَابْ' }));
    fireEvent.click(screen.getByRole('button', { name: 'النتيجة' }));
    expect(screen.getByRole('status').textContent).toMatch(/١ من ١/);
    // The hamza unit has its own.
    fireEvent.click(screen.getByRole('button', { name: 'ء' }));
    expect(screen.getByTestId('quiz-word').textContent).toBe('جُزْءْ');
    fireEvent.click(screen.getByRole('button', { name: 'فِي آخِرِ الْكَلِمَةِ' }));
    fireEvent.click(screen.getByRole('button', { name: 'النتيجة' }));
    expect(screen.getByRole('status').textContent).toMatch(/١ من ١/);
    expect(screen.getByLabelText('النجوم').textContent).toBe('★☆☆☆');
  });

  it('lesson 2: the pairs first, then the pair\'s two letters', () => {
    render(<ArabicLesson lesson={2} content={pairStandIn()} />);
    expect(within(screen.getByRole('navigation', { name: 'الأزواج' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['ب ن']);
    expect(within(screen.getByRole('navigation', { name: 'الحرفان' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['ب', 'ن']);
    expect(screen.queryByRole('navigation', { name: 'الحركات' })).toBeNull();
  });

  it('lesson 2: a pair quiz never uses a word holding both letters of the pair', () => {
    const c = pairStandIn();
    c.units[0]!.words.push({ id: 'ba_vs_nun-002', text: 'بِنْتْ', was: null, review: 'CONTAINS BOTH LETTERS OF THE PAIR' });
    expect(resolveArabicLesson(c, 2)).not.toBeNull();
    c.quiz[0] = { ...c.quiz[0]!, options: ['بِنْتْ', 'نَارْ'] } as never;
    expect(resolveArabicLesson(c, 2)).toBeNull();
  });

  it('lesson 3: the letters first, then that letter\'s harakat; only the letter carrying the mark counts', () => {
    render(<ArabicLesson lesson={3} content={harakatStandIn()} />);
    expect(within(screen.getByRole('navigation', { name: 'الحروف' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['ب']);
    expect(within(screen.getByRole('navigation', { name: 'الحركات' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['بَ', 'بِ']);
    // كَتَبَ under بَ: its ب is the last letter.
    expect(screen.getByTestId('examples-end').textContent).toContain('كَتَبَ');
    fireEvent.click(screen.getByRole('button', { name: 'اِبْحَثْ عَنِ الْحَرْفِ' }));
    const word = () => within(screen.getByRole('group', { name: 'الكلمة' }));
    // In بَابْ, the last ب carries a sukun: it is not بَ.
    fireEvent.click(word().getByRole('button', { name: 'بْ' }));
    expect(screen.getByRole('status').textContent).toBe('حَاوِلْ مَرَّةً أُخْرَى.');
    fireEvent.click(word().getByRole('button', { name: 'بَ' }));
    expect(screen.getByRole('status').textContent).toBe('أَحْسَنْتَ!');
  });
});
