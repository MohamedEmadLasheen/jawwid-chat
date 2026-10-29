import { useMemo } from 'react';
import { NO_AUDIO } from '../audio/audio-controller';
import { manifestSource, useAudioManifest, verifiedAudio } from '../audio/audio-manifest';
import { PlayLesson } from './PlayLesson';

/**
 * PD-49: a surah's games at /lessons/quran/surah-N/play, with recitation as in
 * the lesson (the release gate decides). Ages 3-5 first. It lives here, not in
 * App.tsx, because what it passes (the band, the recitation) changes what a game
 * does: it is part of the code a mechanic's signature covers.
 */
export function PlayRoute({ surah }: { surah: number }) {
  const manifest = useAudioManifest(surah);
  const audio = useMemo(() => (manifest ? { source: manifestSource(manifest), factory: verifiedAudio(manifest) } : null), [manifest]);
  return <PlayLesson surah={surah} band="3-5" audioSource={audio?.source ?? NO_AUDIO} audioFactory={audio?.factory} />;
}
