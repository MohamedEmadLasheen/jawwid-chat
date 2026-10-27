/**
 * PD-37: the words for ticks, Message info, typing and presence. Arabic first,
 * as the rest of the chat; names are anyone's, so no gendered verb.
 */
export const liveCopy = {
  ar: {
    statusSent: 'أُرسلت',
    statusDelivered: 'وصلت',
    statusRead: 'قُرئت',
    messageInfo: 'معلومات الرسالة',
    infoReadBy: 'قُرئت بواسطة',
    infoDeliveredTo: 'وصلت إلى',
    infoPending: 'لم تصل بعد',
    infoNobody: 'لا أحد',
    infoLoading: 'جارٍ التحميل…',
    infoFailed: 'تعذّر تحميل معلومات الرسالة',
    infoClose: 'إغلاق',
    // "جارٍ الكتابة" and "على الخط": no gendered verb or adjective for anyone's name.
    typingOne: (name: string) => `${name}: جارٍ الكتابة…`,
    typingTwo: (a: string, b: string) => `${a} و${b}: جارٍ الكتابة…`,
    typingMany: (n: number) => `${n} أشخاص: جارٍ الكتابة…`,
    online: 'على الخط الآن',
    lastSeen: (when: string) => `آخر ظهور ${when}`,
    hideLastSeen: 'إخفاء آخر ظهور',
    hideLastSeenHint: 'لن يظهر آخر ظهور لك لأحد، ولن يظهر لك آخر ظهور أحد. تظل حالة «على الخط الآن» ظاهرة.',
    presenceTitle: 'الخصوصية',
  },
  en: {
    statusSent: 'Sent',
    statusDelivered: 'Delivered',
    statusRead: 'Read',
    messageInfo: 'Message info',
    infoReadBy: 'Read by',
    infoDeliveredTo: 'Delivered to',
    infoPending: 'Not delivered yet',
    infoNobody: 'Nobody',
    infoLoading: 'Loading…',
    infoFailed: 'Could not load message info',
    infoClose: 'Close',
    typingOne: (name: string) => `${name} is typing…`,
    typingTwo: (a: string, b: string) => `${a} and ${b} are typing…`,
    typingMany: (n: number) => `${n} people are typing…`,
    online: 'Online',
    lastSeen: (when: string) => `Last seen ${when}`,
    hideLastSeen: 'Hide my last seen',
    hideLastSeenHint: "Nobody sees your last seen, and you see nobody's. Online still shows.",
    presenceTitle: 'Privacy',
  },
}

export type LiveCopy = (typeof liveCopy)['en']

export function liveCopyFor(locale: string): LiveCopy {
  return locale === 'ar' ? (liveCopy.ar as unknown as LiveCopy) : liveCopy.en
}

/** "Omar is typing…", "Omar and Noura are typing…", "3 people are typing…". */
export function typingLine(names: readonly string[], copy: LiveCopy): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return copy.typingOne(names[0]!)
  if (names.length === 2) return copy.typingTwo(names[0]!, names[1]!)
  return copy.typingMany(names.length)
}
