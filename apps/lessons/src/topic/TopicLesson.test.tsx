import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { snapshot } from '../test/fixtures';
import { topicStandIn } from '../test/topic-stand-in';
import { TopicLesson } from './TopicLesson';

describe('TopicLesson', () => {
  it('draws a Quran reference from the verified dataset, never the file, and never shows a hadith', async () => {
    const snap = await snapshot(85, 3, { basmala: true });
    render(<TopicLesson lesson={8} content={topicStandIn()} fetcher={snap.fetcher} anchor={snap.anchor} />);
    expect(await screen.findByText(/verse 85:1/)).toBeTruthy();
    expect(screen.getByText(/verse 85:2/).textContent).not.toContain('verse 85:3');
    expect(screen.getByText('نبينا محمد نحبه ونطيعه.')).toBeTruthy();
    expect(screen.queryByText('نص حديث')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'الِاخْتِبَارُ' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('أين ولد النبي؟');
  });

  it('refuses the whole lesson when a reference is outside the verified text', async () => {
    const snap = await snapshot(85, 1, { basmala: true });
    render(<TopicLesson lesson={8} content={topicStandIn()} fetcher={snap.fetcher} anchor={snap.anchor} />);
    expect((await screen.findByRole('alert')).textContent).toBe('تعذّر التحقق من هذا الدرس، فلم يُعرض شيء منه.');
  });

  it('shows nothing of a pending file', () => {
    const c = topicStandIn();
    c.review.status = 'pending';
    render(<TopicLesson lesson={8} content={c} />);
    expect(screen.getByRole('status').textContent).toBe('هذا الدرس قيد المراجعة.');
  });
});
