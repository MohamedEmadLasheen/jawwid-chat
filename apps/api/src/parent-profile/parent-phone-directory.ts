import { Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { PrismaService } from '../platform/prisma.service';

/**
 * Where a typed number with no "+" is read from, and a parent-file phone whose
 * contact has no country: the academy's home country (stats.zone is Cairo).
 */
export const DEFAULT_PHONE_REGION: CountryCode = 'EG';

/** The parents whose file holds a phone, and a way to reach it that never hands the number out. */
export interface ParentPhoneMatch {
  readonly contacts: ReadonlyArray<{ readonly contactId: string; readonly organizationId: string }>;
  /** Calls `send` with the number on file, in E.164. The number is never returned to the caller. */
  deliver(send: (e164: string) => Promise<void>): Promise<void>;
}

/**
 * PD-25 forgot-e-mail: which parents have this phone in their parent file
 * (PD-17)? Lives here because src/parent-profile is the only module that may
 * read chat.parent_file (parent-file-confinement.spec.ts, G-07).
 *
 * The parent file is free text typed by staff ("010 1234 5678", "+971 50...").
 * Both sides are parsed to E.164 -- the stored one with the family's own
 * country -- and only an exact E.164 match counts. A message always goes to the
 * number ON FILE, never to the one typed, so a loose match could at worst
 * message the real owner, never hand a code to the person typing.
 */
@Injectable()
export class ParentPhoneDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async match(typed: string): Promise<ParentPhoneMatch | null> {
    const wanted = toE164(typed, DEFAULT_PHONE_REGION);
    if (!wanted) return null;
    // Narrow by the last seven digits in SQL, then compare exactly in E.164.
    const tail = wanted.slice(-7);
    const rows = await this.prisma.$queryRaw<Array<{ contact_id: string; organization_id: string; phone: string; country_code: string | null }>>`
      select pf.contact_id, pf.organization_id, pf.phone, f.country_code
        from chat.parent_file pf
        join chat.contact c on c.id = pf.contact_id
        left join chat.family f on f.id = c.family_id
       where pf.phone is not null
         and right(regexp_replace(pf.phone, '[^0-9]', '', 'g'), 7) = ${tail}`;
    const contacts = rows
      .filter((r) => toE164(r.phone, (r.country_code as CountryCode | null) ?? DEFAULT_PHONE_REGION) === wanted)
      .map((r) => ({ contactId: r.contact_id, organizationId: r.organization_id }));
    if (contacts.length === 0) return null;
    return { contacts, deliver: (send) => send(wanted) };
  }
}

/** E.164 ("+201001234567"), or null when the text is not a possible phone number. */
export function toE164(text: string, region: CountryCode): string | null {
  const digits = text.trim().replace(/^00/, '+');
  if (digits.length < 5 || digits.length > 32 || !/^[+0-9 ()-]+$/.test(digits)) return null;
  const parsed = parsePhoneNumberFromString(digits, region);
  return parsed && parsed.isPossible() ? parsed.number : null;
}
