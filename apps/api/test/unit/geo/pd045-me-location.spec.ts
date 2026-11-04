/**
 * PD-45 PR-4 (plan §5.4, §6.1 b, §6.2, §8): the parent's own location,
 * `GET /me/location`, `PUT /me/location` and `POST /me/location/later`.
 *
 * Pure: what the body may carry, what the parent is shown, and how the routes
 * are declared (staff refused, writes rationed). The database half -- the
 * caller's own family only, the prompt stamp, the audit -- is
 * test/integration/pd045-me-location.spec.ts.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ActionScope, RATE_LIMITED_ACTION } from '@platform/auth/action-throttle.guard';
import { COMMUNICATION_CONFIG_DEFAULTS } from '@platform/app-config.service';
import { ROUTE_ACCESS } from '@platform/permissions/route-access';
import { CommErrorCode } from '@platform/errors';
import { locationIncomplete, locationNames, parseMyLocation, presentMyLocation } from '../../../src/parent-profile/my-location';
import { MyLocationController } from '../../../src/parent-profile/my-location.controller';

function refusal(f: () => unknown): { code?: string; status?: number; message: string } {
  try {
    f();
  } catch (e) {
    const err = e as { code?: string; status?: number; message: string };
    return { code: err.code, status: err.status, message: err.message };
  }
  throw new Error('expected a refusal');
}

describe('PUT /me/location: the body', () => {
  it('takes a country of the list and one of its subdivisions, in any case', () => {
    expect(parseMyLocation({ countryCode: 'eg', subdivisionCode: 'eg-gz' })).toEqual({ countryCode: 'EG', subdivisionCode: 'EG-GZ' });
    expect(parseMyLocation({ countryCode: 'AE', subdivisionCode: 'AE-DU' })).toEqual({ countryCode: 'AE', subdivisionCode: 'AE-DU' });
  });

  it('takes a country alone: a subdivision left out or null is none (PUT replaces the location)', () => {
    expect(parseMyLocation({ countryCode: 'EG' })).toEqual({ countryCode: 'EG', subdivisionCode: null });
    expect(parseMyLocation({ countryCode: 'EG', subdivisionCode: null })).toEqual({ countryCode: 'EG', subdivisionCode: null });
    // A country with no subdivisions in the list.
    expect(parseMyLocation({ countryCode: 'AW' })).toEqual({ countryCode: 'AW', subdivisionCode: null });
  });

  it('refuses a missing, null or unlisted country with 400 COMMON.VALIDATION: a parent sets a location, never clears it', () => {
    for (const body of [{}, { countryCode: null }, { countryCode: 'ZZ' }, { countryCode: 'UK' }, { countryCode: 'EGY' }, { countryCode: 7 }, { subdivisionCode: 'EG-GZ' }]) {
      const r = refusal(() => parseMyLocation(body));
      expect({ body, code: r.code, status: r.status }).toEqual({ body, code: CommErrorCode.VALIDATION, status: 400 });
      expect(r.message).toMatch(/^countryCode: /);
    }
  });

  it('refuses a subdivision of another country, an unknown one, or a non-string one, naming the field', () => {
    for (const body of [
      { countryCode: 'EG', subdivisionCode: 'AE-DU' },
      { countryCode: 'EG', subdivisionCode: 'EG-XX' },
      { countryCode: 'AW', subdivisionCode: 'AW-01' },
      { countryCode: 'EG', subdivisionCode: 5 },
    ]) {
      const r = refusal(() => parseMyLocation(body));
      expect({ body, code: r.code, status: r.status }).toEqual({ body, code: CommErrorCode.VALIDATION, status: 400 });
      expect(r.message).toMatch(/^subdivisionCode: /);
    }
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, undefined, 'EG', ['EG'], 3]) {
      expect(refusal(() => parseMyLocation(body)).code).toBe(CommErrorCode.VALIDATION);
    }
  });

  it('never reads an owner from the body: a family or contact id in it changes nothing', () => {
    expect(parseMyLocation({ countryCode: 'EG', familyId: 'f', contactId: 'c' })).toEqual({ countryCode: 'EG', subdivisionCode: null });
  });
});

describe('GET /me/location: what the parent is shown', () => {
  it('names the location in both languages, as "country · subdivision"', () => {
    expect(locationNames('EG', 'EG-GZ')).toEqual({ ar: 'مصر · الجيزة', en: 'Egypt · Giza' });
    expect(locationNames('EG', null)).toEqual({ ar: 'مصر', en: 'Egypt' });
    expect(locationNames(null, null)).toBeNull();
    // An old code that is not a country of the list stays readable as itself (PR-5 cleans it).
    expect(locationNames('XQ', null)).toEqual({ ar: 'XQ', en: 'XQ' });
  });

  it('a location is incomplete with no country, an unlisted country, or a country with subdivisions and none chosen (the "Missing location" rule)', () => {
    expect(locationIncomplete(null, null)).toBe(true);
    expect(locationIncomplete('XQ', null)).toBe(true);
    expect(locationIncomplete('EG', null)).toBe(true);
    expect(locationIncomplete('EG', 'EG-GZ')).toBe(false);
    expect(locationIncomplete('AW', null)).toBe(false);
  });

  it('asks once: the prompt is due while the location is incomplete and this contact has not answered', () => {
    expect(presentMyLocation({ countryCode: null, subdivisionCode: null, answered: false, phone: null }).prompt).toBe(true);
    expect(presentMyLocation({ countryCode: null, subdivisionCode: null, answered: true, phone: null }).prompt).toBe(false);
    expect(presentMyLocation({ countryCode: 'EG', subdivisionCode: 'EG-GZ', answered: false, phone: null }).prompt).toBe(false);
    expect(presentMyLocation({ countryCode: 'EG', subdivisionCode: null, answered: false, phone: null }).prompt).toBe(true);
  });

  it('is exactly the §5.4 shape: the two codes, the names, the prompt, and a suggested country only when there is one', () => {
    expect(presentMyLocation({ countryCode: 'EG', subdivisionCode: 'EG-GZ', answered: true, phone: '+971 50 123 4567' })).toEqual({
      countryCode: 'EG', subdivisionCode: 'EG-GZ', location: { ar: 'مصر · الجيزة', en: 'Egypt · Giza' }, prompt: false,
    });
    expect(presentMyLocation({ countryCode: null, subdivisionCode: null, answered: false, phone: '+971 50 123 4567' })).toEqual({
      countryCode: null, subdivisionCode: null, location: null, prompt: true, suggestedCountryCode: 'AE',
    });
  });

  it('suggests a country from an international number only, never from a local one, and never returns the number (§6.2, G-07)', () => {
    const local = presentMyLocation({ countryCode: null, subdivisionCode: null, answered: false, phone: '050 123 4567' });
    expect(local).not.toHaveProperty('suggestedCountryCode');
    const intl = presentMyLocation({ countryCode: null, subdivisionCode: null, answered: false, phone: '+971 50 123 4567' });
    expect(JSON.stringify(intl)).not.toMatch(/971|123|4567/);
    // A family that already has a country is not offered another.
    expect(presentMyLocation({ countryCode: 'EG', subdivisionCode: null, answered: false, phone: '+971 50 123 4567' })).not.toHaveProperty('suggestedCountryCode');
  });
});

describe('the routes', () => {
  const reflector = new Reflector();
  const fn = (name: string) => (MyLocationController.prototype as unknown as Record<string, () => unknown>)[name]!;

  it('are mounted at /me/location: GET, PUT, and POST later', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MyLocationController)).toBe('me/location');
    expect([Reflect.getMetadata(METHOD_METADATA, fn('read')), Reflect.getMetadata(PATH_METADATA, fn('read'))]).toEqual([RequestMethod.GET, '/']);
    expect([Reflect.getMetadata(METHOD_METADATA, fn('save')), Reflect.getMetadata(PATH_METADATA, fn('save'))]).toEqual([RequestMethod.PUT, '/']);
    expect([Reflect.getMetadata(METHOD_METADATA, fn('later')), Reflect.getMetadata(PATH_METADATA, fn('later'))]).toEqual([RequestMethod.POST, 'later']);
  });

  it('are not for staff (PD-40 §8), every one', () => {
    for (const name of ['read', 'save', 'later']) expect(reflector.get(ROUTE_ACCESS, fn(name))).toEqual({ kind: 'not_for_staff' });
  });

  it('ration the writes, not the read', () => {
    expect(reflector.get(RATE_LIMITED_ACTION, fn('save'))).toBe(ActionScope.LOCATION_WRITE);
    expect(reflector.get(RATE_LIMITED_ACTION, fn('later'))).toBe(ActionScope.LOCATION_WRITE);
    expect(reflector.get(RATE_LIMITED_ACTION, fn('read'))).toBeUndefined();
    expect(reflector.get(RATE_LIMITED_ACTION, MyLocationController)).toBeUndefined();
    expect((COMMUNICATION_CONFIG_DEFAULTS as Record<string, unknown>)[`abuse.throttle.${ActionScope.LOCATION_WRITE}`]).toBeGreaterThan(0);
  });
});
