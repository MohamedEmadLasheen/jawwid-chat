import { Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Public } from '../platform/auth/auth.guard';
import { CommError } from '../platform/errors';
import { PrismaService } from '../platform/prisma.service';
import { parseBankAccount } from './billing.service';
import { CheckoutService } from './checkout.service';
import { BANK_ACCOUNT_KEY, PaymentLedger } from './payment-ledger.service';
import { renderPayPage, type PayLang, type PayPageModel } from './pay-page';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

interface HtmlResponse {
  status(code: number): HtmlResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
  redirect(status: number, url: string): void;
}

/**
 * PD-27: the payment link -- `GET /pay/:token` (the page) and
 * `POST /pay/:token/checkout` (to Stripe).
 *
 * PUBLIC to the bearer guard on purpose: the parent may not have an account
 * yet. The token (256 random bits) is the whole capability, and all it grants
 * is to see this one request's amounts and pay it by card. Nothing on the page
 * names a contact channel, another payment or a staff member.
 *
 * The page's CSP replaces the API's `default-src 'none'` for this response
 * only: its own nonce'd style, and a form that posts to itself and is
 * redirected to Stripe Checkout (form-action must allow both).
 */
@Public()
@Controller('pay')
export class PayLinkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: PaymentLedger,
    private readonly checkout: CheckoutService,
  ) {}

  @Get(':token')
  async page(@Param('token') token: string, @Query('lang') lang: string | undefined, @Query('checkout') checkout: string | undefined, @Res() res: HtmlResponse) {
    const model = await this.model(token, checkout === 'success' || checkout === 'cancelled' ? checkout : null);
    this.send(res, model.status === 'not_found' ? 404 : 200, model, token, langOf(lang));
  }

  @Post(':token/checkout')
  async startCheckout(@Param('token') token: string, @Query('lang') lang: string | undefined, @Res() res: HtmlResponse) {
    const l = langOf(lang);
    const request = TOKEN_RE.test(token) ? await this.prisma.paymentRequest.findUnique({ where: { token } }) : null;
    if (!request) return this.send(res, 404, await this.model(token, null), token, l);
    try {
      const url = await this.checkout.open(request, { locale: l, returnUrl: PaymentLedger.linkFor(token) });
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(303, url);
    } catch (e) {
      if (!(e instanceof CommError)) throw e;
      const model = await this.model(token, null);
      model.error = l === 'ar' ? arabicError(e.status) : e.message;
      return this.send(res, e.status === 503 ? 503 : 409, model, token, l);
    }
  }

  private async model(token: string, checkout: PayPageModel['checkout']): Promise<PayPageModel> {
    const request = TOKEN_RE.test(token) ? await this.prisma.paymentRequest.findUnique({ where: { token } }) : null;
    const [bank] = await Promise.all([this.prisma.config.findUnique({ where: { key: BANK_ACCOUNT_KEY } })]);
    if (!request) {
      return {
        status: 'not_found', payerName: null, childFirstName: null, label: '', purpose: 'other', planMonths: null,
        periodStart: null, periodEnd: null, amountMinor: 0, paidMinor: 0, remainingMinor: 0, currency: 'USD',
        expiresAt: null, bankAccount: null, cardAvailable: false, checkout: null, error: null,
      };
    }
    const paid = await this.ledger.standingSum(this.prisma, { requestId: request.id });
    let payerName = request.payerName;
    if (!payerName && request.familyId) {
      payerName = (await this.prisma.family.findUnique({ where: { id: request.familyId }, select: { displayName: true } }))?.displayName ?? null;
    }
    let child = request.childName;
    if (!child && request.learnerId) child = (await this.prisma.learner.findUnique({ where: { id: request.learnerId }, select: { name: true } }))?.name ?? null;
    const amount = Number(request.amountMinor);
    const status = request.paidAt ? 'paid' : request.cancelledAt ? 'cancelled' : request.expiresAt <= new Date() ? 'expired' : 'open';
    return {
      status,
      payerName,
      childFirstName: child ? child.trim().split(/\s+/)[0] ?? null : null,
      label: request.label,
      purpose: request.purpose,
      planMonths: request.planMonths,
      lessonsIncluded: request.lessonsIncluded,
      periodStart: request.periodStart?.toISOString().slice(0, 10) ?? null,
      periodEnd: request.periodEnd?.toISOString().slice(0, 10) ?? null,
      amountMinor: amount,
      paidMinor: paid,
      remainingMinor: Math.max(0, amount - paid),
      currency: request.currency,
      expiresAt: request.expiresAt.toISOString(),
      bankAccount: parseBankAccount(bank?.value),
      cardAvailable: this.checkout.available,
      checkout,
      error: null,
    };
  }

  private send(res: HtmlResponse, status: number, model: PayPageModel, token: string, lang: PayLang) {
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'nonce-${nonce}'; img-src data:; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'`,
    );
    res.status(status).send(renderPayPage(model, lang, { token, nonce }));
  }
}

function langOf(v: string | undefined): PayLang {
  return v === 'en' ? 'en' : 'ar';
}

function arabicError(status: number): string {
  if (status === 503) return 'الدفع بالبطاقة غير متاح حاليًا. يمكنكم الدفع بالتحويل البنكي.';
  if (status === 429) return 'محاولات دفع كثيرة لهذا الطلب. حاولوا مرة أخرى بعد ساعة.';
  return 'لا يمكن الدفع لهذا الطلب الآن.';
}
