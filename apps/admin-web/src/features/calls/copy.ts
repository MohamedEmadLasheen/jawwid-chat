import type { CallFailure } from './callController'

/**
 * The call screen's words, Arabic first. Kept beside the feature, like the chat
 * workspace's copy, so it can be reviewed and merged on its own.
 *
 * An outcome is shown only as the server reported it (`call.ended`): the client
 * never names one of its own.
 */
export interface CallCopy {
  call: string
  groupCall: string
  starting: string
  outgoing: (peer: string) => string
  incoming: (peer: string) => string
  incomingGroup: (peer: string) => string
  answer: string
  decline: string
  hangUp: string
  cancel: string
  connecting: string
  reconnecting: string
  live: string
  waitingForAudio: string
  mute: string
  unmute: string
  enableAudio: string
  close: string
  retry: string
  outcome: Record<string, string>
  endedNoOutcome: string
  failure: Record<CallFailure, string>
  history: string
  hideHistory: string
  noHistory: string
  duration: (seconds: number) => string
  regionLabel: string
  /** Under the name while it rings out. */
  calling: string
  incomingStatus: string
  incomingGroupStatus: string
  /** `missed` on a call this side placed. */
  noAnswer: string
  /** `missed` on a call that rang here. */
  missedIncoming: string
  message: string
  callAgain: string
  recordVoice: string
  windowTitle: string
  moveWindow: string
}

const ar: CallCopy = {
  call: 'اتصال',
  groupCall: 'مكالمة جماعية',
  starting: 'جارٍ بدء المكالمة…',
  outgoing: (peer) => `جارٍ الاتصال بـ ${peer}…`,
  incoming: (peer) => `مكالمة واردة من ${peer}`,
  incomingGroup: (peer) => `مكالمة جماعية من ${peer}`,
  answer: 'رد',
  decline: 'رفض',
  hangUp: 'إنهاء المكالمة',
  cancel: 'إلغاء',
  connecting: 'جارٍ تجهيز الصوت…',
  reconnecting: 'جارٍ إعادة الاتصال…',
  live: 'المكالمة جارية',
  waitingForAudio: 'بانتظار صوت الطرف الآخر',
  mute: 'كتم الميكروفون',
  unmute: 'إلغاء الكتم',
  enableAudio: 'تشغيل الصوت',
  close: 'إغلاق',
  retry: 'إعادة المحاولة',
  outcome: {
    answered: 'انتهت المكالمة',
    declined: 'رُفضت المكالمة',
    missed: 'لم يتم الرد',
  },
  endedNoOutcome: 'انتهت المكالمة',
  failure: {
    notAllowed: 'لا يمكن إجراء هذه المكالمة.',
    alreadyOver: 'انتهت هذه المكالمة بالفعل.',
    network: 'تعذّر الاتصال. تحقق من الشبكة ثم أعد المحاولة.',
    microphone: 'تعذّر الوصول إلى الميكروفون. اسمح للمتصفح باستخدامه ثم أعد المحاولة.',
    unknown: 'حدث خطأ في المكالمة.',
  },
  history: 'سجل المكالمات',
  hideHistory: 'إخفاء السجل',
  noHistory: 'لا توجد مكالمات في هذه المحادثة بعد.',
  duration: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
  regionLabel: 'المكالمة',
  calling: 'جارٍ الاتصال…',
  incomingStatus: 'مكالمة صوتية واردة',
  incomingGroupStatus: 'مكالمة جماعية واردة',
  noAnswer: 'لم يتم الرد',
  missedIncoming: 'مكالمة فائتة',
  message: 'رسالة',
  callAgain: 'معاودة الاتصال',
  recordVoice: 'تسجيل رسالة صوتية',
  windowTitle: 'مكالمة جوّد الصوتية',
  moveWindow: 'اسحب لتحريك نافذة المكالمة',
}

const en: CallCopy = {
  call: 'Call',
  groupCall: 'Group call',
  starting: 'Starting call…',
  outgoing: (peer) => `Calling ${peer}…`,
  incoming: (peer) => `Incoming call from ${peer}`,
  incomingGroup: (peer) => `Group call from ${peer}`,
  answer: 'Answer',
  decline: 'Decline',
  hangUp: 'Hang up',
  cancel: 'Cancel',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  live: 'In call',
  waitingForAudio: 'Waiting for the other side’s audio',
  mute: 'Mute',
  unmute: 'Unmute',
  enableAudio: 'Turn on sound',
  close: 'Close',
  retry: 'Try again',
  outcome: {
    answered: 'Call ended',
    declined: 'Call declined',
    missed: 'No answer',
  },
  endedNoOutcome: 'Call ended',
  failure: {
    notAllowed: 'This call can’t be made.',
    alreadyOver: 'This call has already ended.',
    network: 'Couldn’t connect. Check the network and try again.',
    microphone: 'Couldn’t use the microphone. Allow it in the browser, then try again.',
    unknown: 'Something went wrong with the call.',
  },
  history: 'Call history',
  hideHistory: 'Hide history',
  noHistory: 'No calls in this conversation yet.',
  duration: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
  regionLabel: 'Call',
  calling: 'Calling…',
  incomingStatus: 'Incoming voice call',
  incomingGroupStatus: 'Incoming group call',
  noAnswer: 'No answer',
  missedIncoming: 'Missed call',
  message: 'Message',
  callAgain: 'Call again',
  recordVoice: 'Record voice message',
  windowTitle: 'Jawwid voice call',
  moveWindow: 'Drag to move the call window',
}

export function callCopyFor(locale: string): CallCopy {
  return locale === 'ar' ? ar : en
}
