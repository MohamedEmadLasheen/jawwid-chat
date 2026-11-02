import { escapeHtml } from '../billing/pay-page';

export type DeletionLang = 'ar' | 'en';
export type DeletionPageState =
  | { kind: 'form'; error?: 'incomplete' | 'invalid' | 'locked' | 'rate_limited' | 'staff' }
  | { kind: 'done' };

const T = {
  ar: {
    title: 'حذف حساب جوّد',
    intro: 'يمكن لولي الأمر أو المعلّم حذف حسابه هنا، أو من التطبيق: الإعدادات ← حذف الحساب.',
    goes: 'ما يُحذف فورًا',
    goesList: [
      'اسمك وصورتك ونبذتك، ويظهر اسمك بعدها «مستخدم محذوف»',
      'بريدك الإلكتروني ورقم هاتفك المحفوظان لدى الإدارة',
      'كلمة المرور وجميع الجلسات، فتخرج من كل الأجهزة',
      'رموز الإشعارات وإشعاراتك',
    ],
    kept: 'ما يُحتفظ به',
    keptList: [
      'المدفوعات والفواتير والإيصالات وسجل التدقيق لمدة 7 سنوات، باسم «مستخدم محذوف»',
      'الرسائل التي أرسلتها تبقى في المحادثات باسم «مستخدم محذوف»، لأن الطرف الآخر يحتفظ بسجله',
      'سجلات الأبناء لدى الأكاديمية لا تُحذف، ويُبلَّغ فريق العمل لمتابعتها',
    ],
    username: 'البريد الإلكتروني الذي تسجّل به الدخول',
    password: 'كلمة المرور',
    confirm: 'أفهم أن الحذف نهائي ولا يمكن التراجع عنه',
    submit: 'حذف حسابي نهائيًا',
    done: 'تم حذف حسابك. خرجت من جميع الأجهزة، ويمكنك إغلاق هذه الصفحة.',
    errors: {
      incomplete: 'اكتب البريد الإلكتروني وكلمة المرور، وأكّد أنك تفهم أن الحذف نهائي.',
      invalid: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      locked: 'الحساب مقفل مؤقتًا بعد محاولات كثيرة. حاول لاحقًا.',
      rate_limited: 'محاولات كثيرة. حاول مرة أخرى بعد قليل.',
      staff: 'حسابات فريق العمل تُغلق عن طريق الإدارة.',
    },
    other: 'English',
  },
  en: {
    title: 'Delete your Jawwid account',
    intro: 'A parent or a teacher can delete their account here, or in the app: Settings → Delete account.',
    goes: 'Deleted now',
    goesList: [
      'Your name, photo and about text; you are shown as "Deleted user" from then on',
      'The e-mail address and phone number the academy holds for you',
      'Your password and every session: you are signed out everywhere',
      'Your push tokens and your notifications',
    ],
    kept: 'Kept',
    keptList: [
      'Payments, invoices, receipts and the audit log, for 7 years, as "Deleted user"',
      'Messages you sent stay in their conversations as "Deleted user": the other members keep their history',
      'Your children’s records at the academy are not deleted; the staff are told so they can follow up',
    ],
    username: 'The e-mail address you sign in with',
    password: 'Password',
    confirm: 'I understand that deleting is final and cannot be undone',
    submit: 'Delete my account for good',
    done: 'Your account has been deleted. You are signed out everywhere; you can close this page.',
    errors: {
      incomplete: 'Enter your e-mail address and password, and confirm that you understand deleting is final.',
      invalid: 'The e-mail address or password is not right.',
      locked: 'The account is locked for a while after too many attempts. Try again later.',
      rate_limited: 'Too many attempts. Try again in a little while.',
      staff: 'Staff accounts are closed by the administration.',
    },
    other: 'العربية',
  },
} as const;

/** PD-56: the public account-deletion page. No script; every value escaped. */
export function renderDeletionPage(lang: DeletionLang, state: DeletionPageState, nonce: string): string {
  const t = T[lang];
  const e = escapeHtml;
  const list = (items: readonly string[]) => `<ul>${items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>`;
  const otherLang = lang === 'ar' ? 'en' : 'ar';
  const body =
    state.kind === 'done'
      ? `<p class="ok" role="status">${e(t.done)}</p>`
      : `${state.error ? `<p class="err" role="alert">${e(t.errors[state.error])}</p>` : ''}
<form method="post" action="?lang=${lang}">
  <label>${e(t.username)}<input name="username" type="email" autocomplete="username" required dir="ltr"></label>
  <label>${e(t.password)}<input name="password" type="password" autocomplete="current-password" required dir="ltr"></label>
  <label class="check"><input name="confirm" type="checkbox" value="yes" required> ${e(t.confirm)}</label>
  <button type="submit">${e(t.submit)}</button>
</form>`;
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(t.title)}</title>
<style nonce="${nonce}">
  body { font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; margin: 0; background: #f6f7f8; color: #1d2327; line-height: 1.55; }
  main { max-width: 34rem; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; }
  h2 { font-size: 1rem; margin: 20px 0 4px; }
  ul { margin: 0; padding-inline-start: 1.2rem; }
  form { display: grid; gap: 12px; margin-top: 20px; background: #fff; padding: 16px; border-radius: 10px; border: 1px solid #dcdfe3; }
  label { display: grid; gap: 4px; font-weight: 600; }
  label.check { display: flex; gap: 8px; align-items: flex-start; font-weight: 400; }
  input[type=email], input[type=password] { font: inherit; padding: 10px; border: 1px solid #b8bec5; border-radius: 8px; }
  button { font: inherit; padding: 12px; border: 0; border-radius: 8px; background: #b42318; color: #fff; font-weight: 600; cursor: pointer; }
  .err { background: #fdecea; color: #8a1c13; padding: 10px; border-radius: 8px; }
  .ok { background: #e7f6ec; color: #135c2e; padding: 12px; border-radius: 8px; }
  .lang { display: inline-block; margin-top: 24px; color: #1d4e89; }
</style>
</head>
<body>
<main>
  <h1>${e(t.title)}</h1>
  <p>${e(t.intro)}</p>
  <h2>${e(t.goes)}</h2>${list(t.goesList)}
  <h2>${e(t.kept)}</h2>${list(t.keptList)}
  ${body}
  <a class="lang" href="?lang=${otherLang}" hreflang="${otherLang}">${e(t.other)}</a>
</main>
</body>
</html>`;
}
