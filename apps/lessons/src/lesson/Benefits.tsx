import { useState } from 'react';
import type { ResolvedContent } from '../content/lesson-content';

/** What the surah teaches: lessons learned, a reflection question, "did you know" -- reviewed prose only. */
export function Benefits({ content, onDone }: { content: ResolvedContent; onDone: () => void }) {
  const [ideas, setIdeas] = useState(false);
  return (
    <section aria-label="الفوائد">
      {content.lessons.length ? (
        <>
          <h2>ماذا نتعلم من السورة؟</h2>
          <ul className="benefits">
            {content.lessons.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : null}
      {content.reflection ? (
        <>
          <h2>سؤال التأمل</h2>
          <p>{content.reflection.question}</p>
          {ideas ? (
            <ul className="benefits">
              {content.reflection.ideas.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <button type="button" onClick={() => setIdeas(true)}>
              اعرض بعض الأفكار
            </button>
          )}
        </>
      ) : null}
      {content.didYouKnow.length ? (
        <>
          <h2>هل تعلم؟</h2>
          <ul className="benefits">
            {content.didYouKnow.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </>
      ) : null}
      <button type="button" className="primary" onClick={onDone}>
        أنهيت الفوائد
      </button>
    </section>
  );
}
