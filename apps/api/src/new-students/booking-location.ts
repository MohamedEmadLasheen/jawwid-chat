import type { Prisma, PrismaClient } from '@prisma/client';
import { locationOf, parseLocation, type LocationValue } from '../geo/location';

/**
 * PD-45 (owner 2026-10-29, "At booking too"; plan §5.5): the country and
 * subdivision given when a trial is booked, kept in chat.trial_prospect_location
 * BESIDE the prospect -- a prospect is a display name only (BR-2), and every
 * booking change is a card in the teacher's trial group. This module is its one
 * writer and its one reader (trial-prospect-location-confinement.spec.ts):
 * TrialService hands it the booking's raw `location` and asks it for the
 * pre-fill of Sales' subscription form, never touching the row itself.
 *
 * The database forgets the row 90 days after a trial that led to no
 * subscription (chat.purge_trial_prospect_locations, in the PD-32 purge).
 */
export function parseBookingLocation(raw: unknown): LocationValue | null | undefined {
  return raw === undefined ? undefined : parseLocation(raw, 'location');
}

/** Upsert the booking's location (null clears nothing: a booking without one leaves an earlier one). Inside the booking's transaction. */
export async function recordBookingLocation(
  tx: Prisma.TransactionClient,
  input: { prospectId: string; organizationId: string; location: LocationValue | null | undefined; by: string },
): Promise<void> {
  if (!input.location?.countryCode) return;
  const data = { countryCode: input.location.countryCode, subdivisionCode: input.location.subdivisionCode, recordedBy: input.by };
  await tx.trialProspectLocation.upsert({
    where: { prospectId: input.prospectId },
    create: { prospectId: input.prospectId, organizationId: input.organizationId, ...data },
    update: data,
  });
}

/** The pre-fill of Sales' subscription form: the booking's location, named, or null. */
export async function bookingLocationOf(prisma: Pick<PrismaClient, 'trialProspectLocation'>, organizationId: string, prospectId: string | null) {
  if (!prospectId) return null;
  const row = await prisma.trialProspectLocation.findFirst({ where: { prospectId, organizationId } });
  return row ? locationOf(row.countryCode, row.subdivisionCode) : null;
}
