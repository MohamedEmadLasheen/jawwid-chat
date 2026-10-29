import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readingStandIn } from '../test/reading-stand-in';
import { ReadingLesson } from './ReadingLesson';

describe('ReadingLesson (P0-5c)', () => {
  it('shows nothing of a pending file', () => {
    const c = readingStandIn();
    c.review.status = 'pending';
    render(<ReadingLesson lesson={5} content={c} />);
    expect(screen.getByRole('status').textContent).toBe('هذا الدرس قيد المراجعة.');
  });

  it('reads a stage, labels a drill as syllables, and shows the passage', () => {
    render(<ReadingLesson lesson={5} content={readingStandIn()} />);
    expect(within(screen.getByRole('navigation', { name: 'المراحل' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['الْفَتْحَةْ', 'الْكَسْرَةْ', 'جُمَلْ']);
    expect(screen.getByText('بَتَ').closest('li')!.textContent).toContain('مَقَاطِعُ');
    expect(screen.getByRole('heading', { name: 'الْقِطَّةُ' })).toBeTruthy();
  });

  it('shows each passage once, whatever the stage, and even when every stage is held', () => {
    render(<ReadingLesson lesson={5} content={readingStandIn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'الْكَسْرَةْ' }));
    expect(screen.getAllByRole('heading', { name: 'الْقِطَّةُ' })).toHaveLength(1);
  });

  it('lesson 10: the passage\'s sentences are put in order too', () => {
    render(<ReadingLesson lesson={5} content={readingStandIn()} shuffleSeed={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'رَتِّبِ الْكَلِمَاتِ' }));
    expect(screen.getByRole('region', { name: 'رتّب الجمل' })).toBeTruthy();
  });

  it('the order game is answered by the sentence itself', () => {
    render(<ReadingLesson lesson={5} content={readingStandIn()} shuffleSeed={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'جُمَلْ' }));
    fireEvent.click(screen.getByRole('button', { name: 'رَتِّبِ الْكَلِمَاتِ' }));
    const game = () => within(screen.getByRole('region', { name: 'رتّب الكلمات' }));
    const target = ['أَكَلَ', 'الْوَلَدُ', 'تُفَّاحًا'];
    // Bubble each word into place, then check.
    for (let i = 0; i < target.length; i++) {
      let cards = game().getAllByRole('listitem');
      let at = cards.findIndex((c) => c.textContent!.startsWith(target[i]!));
      while (at > i) {
        fireEvent.click(within(cards[at]!).getByRole('button', { name: 'قبلها' }));
        cards = game().getAllByRole('listitem');
        at -= 1;
      }
    }
    fireEvent.click(game().getByRole('button', { name: 'تحقّق' }));
    expect(screen.getByRole('status').textContent).toBe('أَحْسَنْتَ!');
  });

  it('the quiz opens on the stage-vowel question', () => {
    render(<ReadingLesson lesson={5} content={readingStandIn()} shuffleSeed={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'الِاخْتِبَارُ' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('أَيُّهَا كُلُّهُ بِـالْفَتْحَةْ؟');
  });
});
