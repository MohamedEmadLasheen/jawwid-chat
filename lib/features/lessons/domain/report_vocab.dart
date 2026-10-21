import '../../../l10n/app_localizations.dart';

/// PD-15: the quick choices of a lesson report -- the same codes as the server's
/// `apps/api/src/lessons/report-vocab.ts`. The server validates them; a code this build
/// does not know is shown as the code, never dropped.
const coveredTopicCodes = <String>[
  'new_memorization', 'revision', 'recitation', 'tajweed', 'reading',
  'writing', 'grammar', 'vocabulary', 'islamic_studies', 'assessment',
];

const nextTaskCodes = <String>[
  'memorize_new', 'revise_previous', 'practise_recitation', 'practise_reading',
  'written_homework', 'prepare_next', 'nothing',
];

/// Highest first, the order a teacher reads them in.
const performanceLevels = <int>[5, 4, 3, 2, 1];

String topicLabel(L10n l10n, String code) => switch (code) {
      'new_memorization' => l10n.topicNewMemorization,
      'revision' => l10n.topicRevision,
      'recitation' => l10n.topicRecitation,
      'tajweed' => l10n.topicTajweed,
      'reading' => l10n.topicReading,
      'writing' => l10n.topicWriting,
      'grammar' => l10n.topicGrammar,
      'vocabulary' => l10n.topicVocabulary,
      'islamic_studies' => l10n.topicIslamicStudies,
      'assessment' => l10n.topicAssessment,
      _ => code,
    };

String taskLabel(L10n l10n, String code) => switch (code) {
      'memorize_new' => l10n.taskMemorizeNew,
      'revise_previous' => l10n.taskRevisePrevious,
      'practise_recitation' => l10n.taskPractiseRecitation,
      'practise_reading' => l10n.taskPractiseReading,
      'written_homework' => l10n.taskWrittenHomework,
      'prepare_next' => l10n.taskPrepareNext,
      'nothing' => l10n.taskNothing,
      _ => code,
    };

String? performanceLabel(L10n l10n, int? level) => switch (level) {
      5 => l10n.level5,
      4 => l10n.level4,
      3 => l10n.level3,
      2 => l10n.level2,
      1 => l10n.level1,
      _ => null,
    };
