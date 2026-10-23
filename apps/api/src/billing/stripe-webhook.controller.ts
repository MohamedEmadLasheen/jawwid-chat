import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { Public } from '../platform/auth/auth.guard';
import { CheckoutService } from './checkout.service';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe.gateway';

interface RawBodyRequest {
  rawBody?: Buffer;
}

/**
 * PD-27: `POST /stripe/webhook` -- the only way a card payment becomes real.
 *
 * PUBLIC to the bearer guard, authenticated to Stripe: the `Stripe-Signature`
 * header (an HMAC over a timestamp and the RAW body, with
 * STRIPE_WEBHOOK_SECRET) is verified by the Stripe SDK before anything is
 * read. `rawBody: true` in main.ts keeps the bytes as they arrived; a
 * re-serialized object would never verify.
 *
 *   503  no webhook secret on this deployment (Stripe retries for three days)
 *   400  unverifiable: nothing is read, nothing is touched
 *   200  every verified event -- recorded, a duplicate, or ignored. A non-2xx
 *        for "already seen" would only buy a retry loop.
 *   500  a database failure while recording: Stripe retries, and the event id,
 *        the session id and the payment intent keep the retry exactly-once.
 *
 * Logs the event type and the outcome, never the body, the header or a key.
 */
@Public()
@Controller('stripe')
export class StripeWebhookController {
  private readonly log = new Logger(StripeWebhookController.name);

  constructor(
    private readonly checkout: CheckoutService,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() request: RawBodyRequest, @Headers('stripe-signature') signature?: string): Promise<{ received: true; outcome: string }> {
    if (!this.stripe.webhookAvailable) throw new ServiceUnavailableException();
    const raw = request.rawBody;
    if (!raw || raw.length === 0) throw new BadRequestException();
    let event: Stripe.Event;
    try {
      event = this.stripe.verifyWebhook(raw, signature);
    } catch {
      this.log.warn('stripe webhook: rejected, signature did not verify');
      throw new BadRequestException();
    }
    const outcome = await this.checkout.handleEvent(event);
    this.log.log(`stripe webhook: ${event.type} -> ${outcome}`);
    return { received: true, outcome };
  }
}
