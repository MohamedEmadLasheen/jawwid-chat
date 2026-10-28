/**
 * Materials recitations may point only at hosts allowed in code, and none is
 * allowed by default: no family reaches an unlicensed external recitation.
 */
import { ALLOWED_RECITATION_HOSTS, recitationHostOf } from '../../../src/materials/recitation-hosts';

describe('recitation hosts', () => {
  it('none is allowed by default', () => {
    expect(ALLOWED_RECITATION_HOSTS).toEqual([]);
    expect(recitationHostOf(ALLOWED_RECITATION_HOSTS, 'https://server8.mp3quran.net/afs/085.mp3')).toBeNull();
  });

  it('matches the exact host over https only', () => {
    const hosts = [{ host: 'audio.example.test', licence: null }];
    expect(recitationHostOf(hosts, 'https://audio.example.test/001.mp3')).toBe(hosts[0]);
    expect(recitationHostOf(hosts, 'https://AUDIO.example.test/001.mp3')).toBe(hosts[0]);
    for (const url of ['http://audio.example.test/001.mp3', 'https://evil.audio.example.test/x', 'https://audio.example.test.evil.test/x', 'not a url']) {
      expect(recitationHostOf(hosts, url)).toBeNull();
    }
  });
});
