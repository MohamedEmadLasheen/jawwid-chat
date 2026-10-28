import type { Position } from './letters';

/**
 * The engine's own Arabic wording for the letters lesson (questions, labels,
 * feedback). It is authored text, fully vowelled, and is listed in the lesson's
 * review doc for the Teachers department to sign off with the content
 * (pd029-p05-arabic-letters-design.md §6).
 */
export const POSITION_LABEL: Record<Position, string> = {
  start: 'فِي أَوَّلِ الْكَلِمَةِ',
  middle: 'فِي وَسَطِ الْكَلِمَةِ',
  end: 'فِي آخِرِ الْكَلِمَةِ',
};

export const askContains = (name: string) => `أَيُّ كَلِمَةٍ فِيهَا حَرْفُ «${name}»؟`;
export const askPosition = (name: string) => `أَيْنَ حَرْفُ «${name}» فِي هٰذِهِ الْكَلِمَةِ؟`;
export const askFind = (name: string) => `اُنْقُرْ عَلَى حَرْفِ «${name}».`;
export const askPick = (name: string) => `اِخْتَرْ كُلَّ كَلِمَةٍ فِيهَا حَرْفُ «${name}».`;

export const TEXT = {
  forms: 'أَشْكَالُ الْحَرْفِ',
  right: 'أَحْسَنْتَ!',
  again: 'حَاوِلْ مَرَّةً أُخْرَى.',
  next: 'التَّالِي',
  check: 'تَحَقَّقْ',
  notYet: 'لَيْسَ بَعْدُ، اُنْظُرْ مَرَّةً أُخْرَى.',
  done: 'أَنْهَيْتُ',
} as const;
