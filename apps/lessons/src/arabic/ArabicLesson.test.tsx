import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ArabicLesson } from './ArabicLesson';
import { standIn } from '../test/arabic-stand-in';
import { App } from '../App';

describe('the Arabic letters lesson page', () => {
  it('shows nothing of a pending file, and nothing of a lesson without content', () => {
    const pending = standIn();
    pending.review.status = 'pending';
    const { unmount } = render(<ArabicLesson lesson={1} content={pending} />);
    expect(screen.getByRole('status').textContent).toBe('هذا الدرس قيد المراجعة.');
    expect(screen.queryByText('كِتَابْ')).toBeNull();
    unmount();
    render(<App pathname="/lessons/arabic/lesson-1" />);
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

  it('the quiz asks the proved questions and earns its star once', () => {
    render(<ArabicLesson lesson={1} content={standIn()} shuffleSeed={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'الِاخْتِبَارُ' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('أَيُّ كَلِمَةٍ فِيهَا حَرْفُ «أَلِفْ»؟');
    fireEvent.click(screen.getByRole('button', { name: 'كِتَابْ' }));
    fireEvent.click(screen.getByRole('button', { name: 'التالي' }));
    expect(screen.getByTestId('quiz-word').textContent).toBe('جُزْءْ');
    fireEvent.click(screen.getByRole('button', { name: 'فِي آخِرِ الْكَلِمَةِ' }));
    fireEvent.click(screen.getByRole('button', { name: 'النتيجة' }));
    expect(screen.getByRole('status').textContent).toMatch(/٢ من ٢/);
    expect(screen.getByLabelText('النجوم').textContent).toBe('★☆☆☆');
  });
});
