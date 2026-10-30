import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { islamicLessonFor } from './index';
import { settled } from '../test/topic-settled';
import { TopicLesson } from '../topic/TopicLesson';
import type { TopicLesson as TopicFile } from '../topic/topic';

describe('Islamic Studies batch 1 on the page', () => {
  it('shows nothing of a real file while it is pending', () => {
    for (const n of [8, 9, 10, 11, 20]) {
      const { unmount } = render(<TopicLesson lesson={n} />);
      expect(screen.getByRole('status').textContent).toBe('هذا الدرس قيد المراجعة.');
      unmount();
    }
  });

  it('settled and approved, lesson 9 shows its prose and never a hadith', async () => {
    const c = settled(islamicLessonFor(9) as TopicFile);
    render(<TopicLesson lesson={9} content={c} />);
    await act(async () => {}); // the (empty) Quran load settles
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('رحمته ﷺ');
    const hadith = c.sections.flatMap((s) => s.blocks).filter((b) => b.kind === 'hadith');
    expect(hadith).toHaveLength(3);
    const page = document.body.textContent ?? '';
    for (const h of hadith) if (h.kind === 'hadith') expect(page).not.toContain(h.text);
    expect(page).not.toContain('الراحمون يرحمهم الرحمن');
    expect(page).toContain('رحمة نبينا محمد ﷺ');
  });
});
