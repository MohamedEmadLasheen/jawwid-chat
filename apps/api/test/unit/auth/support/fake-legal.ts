import type { LegalService } from '../../../../src/legal/legal.service';
import type { LegalDto } from '../../../../src/legal/legal-documents';

/**
 * PD-58: a LegalService stand-in for unit specs that build the auth
 * controllers by hand. It answers the `legal` block those responses carry;
 * the gate itself is proved in test/unit/legal and pd058-legal.spec.ts.
 */
export function fakeLegal(legal: LegalDto = { state: 'accepted', required: [], unavailable: [] }): LegalService {
  return { dtoFor: async () => legal } as unknown as LegalService;
}

export const NO_LEGAL_SERVICE = fakeLegal();
