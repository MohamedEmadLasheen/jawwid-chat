import { J } from './copy'

/** The few journey strings the chat thread needs outside a hook. */
export function journeyCopyFor(locale: 'ar' | 'en') {
  return { openRecord: locale === 'ar' ? J.openRecord.ar : J.openRecord.en }
}
