import { CardKind } from '../../../src/communication/contracts/vocab';
import { PRAISE_QUOTE_MAX, renderCardBody } from '../../../src/lessons/lesson-card';

/** PD-52 PR-8: the text the teacher reads when staff share a parent's praise. */
describe('PD-52 shared-praise card body', () => {
  const payload = { feedbackId: 'f-1', childFirstName: 'Omar', body: 'She is wonderful with my son.' };

  it('names the child and quotes the words, in both languages', () => {
    expect(renderCardBody(CardKind.TEACHER_PRAISE_SHARED, payload, 'en')).toBe('💐 Praise from Omar\'s parent\n“She is wonderful with my son.”');
    expect(renderCardBody(CardKind.TEACHER_PRAISE_SHARED, payload, 'ar')).toBe('💐 ثناء من ولي أمر Omar\n«She is wonderful with my son.»');
  });

  it('cuts a long quote to the card limit with an ellipsis, never splitting an emoji', () => {
    const long = `${'a'.repeat(PRAISE_QUOTE_MAX - 2)}😀😀😀 tail`;
    const body = renderCardBody(CardKind.TEACHER_PRAISE_SHARED, { ...payload, body: long }, 'en');
    const quote = body.split('\n')[1]!.slice(1, -1);
    expect(Array.from(quote)).toHaveLength(PRAISE_QUOTE_MAX);
    expect(quote.endsWith('😀…')).toBe(true);
    expect(quote).not.toContain('tail');
    const exact = 'b'.repeat(PRAISE_QUOTE_MAX);
    expect(renderCardBody(CardKind.TEACHER_PRAISE_SHARED, { ...payload, body: exact }, 'en')).toContain(`“${exact}”`);
  });

  it('carries no field but the child\'s first name and the words, so a parent name in the payload never shows', () => {
    const body = renderCardBody(CardKind.TEACHER_PRAISE_SHARED, { ...payload, parentName: 'parent_p', contactName: 'parent_p' }, 'en');
    expect(body).not.toContain('parent_p');
  });
});
