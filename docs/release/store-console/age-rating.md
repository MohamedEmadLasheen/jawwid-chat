# Age rating: Apple's questionnaire and Play's IARC questionnaire

**Launch item LR-09. Draft, 2026-11-08.** Written from the code on `main` @ `cf731af2`.

**Key point:** the age rating describes the app's **content and capabilities**. Who the app is for (the
target audience) is a separate answer: `play-declarations.md` §1 for Play, and the Kids Category choice
below for Apple. The recommended audience is **account holders 18 and over, not the Kids Category**
`[OWNER DECISION: N-1 / LD-5]`. Children take part in lessons, but they use the app on a parent's
signed-in phone, never with their own account (`lib/shared/models/user_role.dart:9-21`).

---

## 1. Apple: App Store Connect → App Information → Age Rating → Set Up Age Ratings

Apple's current questionnaire (the 2025–2026 version, with the 13+, 16+ and 18+ ratings) was read on
2026-11-08 from:
- <https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/>
- <https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/>

Those pages give the topics but not the exact question wording. Match each answer to the live wording on
the day. Content questions have frequency levels (None, Infrequent, Frequent); capability questions are
Yes or No.

### 1.1 In-app controls

| Question | Answer | Reasoning and evidence |
|---|---|---|
| Parental Controls | **No** | The app lock (Face ID, fingerprint or passcode: `ios/Runner/Info.plist:65-69`) protects the parent's account. It does not let a parent restrict what a child sees, so it is not a parental control. |
| Age Assurance | **No** `[OWNER DECISION: storefronts, LR-17 / LD-15]` | The app does not check age. If the owner distributes in Texas, Utah or Louisiana, the Declared Age Range API becomes required and this changes to Yes once it is built (launch item LR-17). |

### 1.2 Capabilities

| Question | Answer | Reasoning and evidence |
|---|---|---|
| Unrestricted Web Access | **No** | The only in-app web view loads the academy's own lesson activities and refuses any other page (`lib/features/materials/presentation/activity_view_mobile.dart:62-68`). Links (legal pages, a story's button, a file) open in the system browser, outside the app (`lib/core/legal/legal_links.dart:73`; `lib/core/media/attachment_opener.dart:40`). |
| User-Generated Content | **Yes** | People post text, photos, videos, voice messages and files in conversations (`lib/core/data/http/http_message_repository.dart:99`, `:215`). Reporting and blocking exist (PD-57: `lib/core/data/http/http_moderation_repository.dart:21`; `lib/core/data/http/http_block_repository.dart:23`). |
| Messaging and Chat | **Yes** | One-to-one and group chat, and audio calls (`lib/features/calls/`). |
| Social Media | **No** `[OWNER DECISION: confirm; Store compliance recommends No]` | There are no public profiles, followers, public feed or discovery of strangers. Conversations are set up by the academy for a family, its teacher and its supervisor. Stories are announcements that only the academy publishes; the app cannot publish one (`lib/core/data/http/http_story_repository.dart:17-18`). If App Review disagrees, the answer becomes Yes, and the next question applies. |
| Social Media Disabled for Users Under 13 | **Not applicable** (asked only if Social Media is Yes) | If it is ever Yes: children have no accounts, so Yes would be truthful. |
| Advertising | **No** | No advertising SDK (`docs/legal/data-inventory-and-retention-matrix.md` §2, "Not used"). Stories are the academy's own announcements to its families, not ads. |

### 1.3 Content descriptors

| Topic | Question | Answer | Reasoning |
|---|---|---|---|
| Mature Themes | Profanity or Crude Humor | **None** | The academy's content has none. User messages are covered by the User-Generated Content answer, and a word filter refuses listed words (launch item LR-16). |
| Mature Themes | Horror/Fear Themes | **None** | — |
| Mature Themes | Alcohol, Tobacco, or Drug Use or References | **None** | — |
| Medical or Wellness | Medical or Treatment Information | **None** | — |
| Medical or Wellness | Health or Wellness Topics | **None** | — |
| Sexuality or Nudity | Mature or Suggestive Themes | **None** | — |
| Sexuality or Nudity | Sexual Content or Nudity | **None** | — |
| Sexuality or Nudity | Graphic Sexual Content and Nudity | **None** | — |
| Violence | Cartoon or Fantasy Violence | **None** | The learning games (`apps/lessons/src/games/`) are Quran and reading activities. Confirm on a final read of the games. |
| Violence | Realistic Violence | **None** | — |
| Violence | Prolonged Graphic or Sadistic Realistic Violence | **None** | — |
| Violence | Guns or Other Weapons | **None** | — |
| Chance-Based Activities | Gambling | **No** | — |
| Chance-Based Activities | Simulated Gambling | **None** | — |
| Chance-Based Activities | Contests | **None** | Rewards and certificates are given by the teacher for a child's own work (`lib/features/rewards/`); there is no competition between users and no prize. |
| Chance-Based Activities | Loot Boxes | **No** | Nothing is bought or won by chance. |

### 1.4 The result and the remaining choices

- **Expected calculated rating: 4+.** With these answers, the only "Yes" items are User-Generated Content
  and Messaging and Chat, which Apple maps to 4+. Check the rating App Store Connect shows before saving.
- **Age Suitability URL (optional):** leave empty.
- **Age Categories and Override:** choose **Not Applicable** (no Kids Category, no override).
  - Kids Category: **not chosen** (compliance checklist Q-F). The app takes payments, uses Sentry, opens
    links outside the app and is run by the parent. Apple's Kids rules (1.3) would forbid most of that.
  - Override to a higher rating: **not recommended** `[OWNER DECISION]`. The content is Quran education.
    A higher rating would not keep children out (they never sign in) and would hide the app on parents'
    phones that have Screen Time limits. If counsel prefers it, 13+ is the smallest step.
- **Metadata:** never use "For Kids" or "For Children" in the name, subtitle or description (Apple 2.3.8).
  `listing-copy.md` follows this.

---

## 2. Google Play: App content → Content rating (IARC questionnaire)

**Re-read before submitting.** The IARC questionnaire changes its wording and adapts to earlier answers.
The questions below are the ones the questionnaire asks for an app of this kind; answer the live question
with the same facts.

### 2.1 Set-up

| Field | Answer |
|---|---|
| E-mail address for the rating certificate | `{{RATING_CONTACT_EMAIL}}` |
| Category | **"All Other App Types"** (also called "Reference, News, Educational or Utility" in some versions). Not "Game", not "Social Networking": the app is an academy's communication and lesson app. |

### 2.2 Content questions

| Question (meaning) | Answer | Reasoning |
|---|---|---|
| Violence, blood, gore | **No** | — |
| Fear, horror | **No** | — |
| Sexuality, nudity | **No** | — |
| Language (profanity, crude humour) | **No** | The academy's content has none; user content is covered below. |
| Controlled substances (drugs, alcohol, tobacco) | **No** | — |
| Gambling, simulated gambling | **No** | — |
| Crude or discriminatory humour | **No** | — |
| Does the app contain material that may be offensive to some religious or ethnic groups? (if asked) | **No** | Religious educational content presented respectfully is not offensive content. |

### 2.3 Interactive elements and functionality

| Question (meaning) | Answer | Reasoning |
|---|---|---|
| Does the app let users interact or exchange content with each other (chat, messages, user-generated content)? | **Yes** | Chat, voice messages, photos, calls. IARC adds the "Users Interact" notice. |
| Is the interaction moderated? (if asked) | **Yes**: reporting, blocking, a staff moderation queue and a server-side word filter | PD-57; LR-16 |
| Does the app share the user's current physical location with other users? | **No** | The parent's country and region are seen only by Super Admin, Operations and Sales, never by teachers or other parents (data inventory §3; DEV-CONFIRM #11 still asks engineering to confirm the routes). No device location at all. |
| Does the app allow users to share personal information with third parties? ("Shares Info") | **No** `[OWNER DECISION: confirm with counsel]` | Users can type anything in a message, but the app does not pass personal information to third parties; processors act for the academy. If counsel reads "a message to another family member" as sharing, answer Yes; it adds a notice and does not change the rating. |
| Does the app allow purchases of digital goods? | **No** | Only live one-to-one lessons (a service) are paid in the app; nothing digital is sold (`docs/release/app-review-notes-payments.md` §2). |
| Does the app contain ads? | **No** | — |
| Does the app provide unrestricted internet access (a browser)? | **No** | See Apple §1.2. |
| Is the app primarily a web browser or search engine? | **No** | — |

### 2.4 Expected result

**Expected: the lowest rating in each system** (for example ESRB Everyone, PEGI 3, USK 0), **with the
interactive-element notice "Users Interact"**. Some IARC authorities raise the rating of apps with
unmoderated chat; the moderation answer above matters. Check the result screen before applying it.

---

## 3. What depends on the owner

| # | Decision | Recommended | Changes |
|---|---|---|---|
| 1 | Target audience (N-1 / LD-5) | Account holders 18+; not Kids | Apple Kids Category; Play target audience and Families policy |
| 2 | Storefronts (LD-15, LR-17) | Academy markets first; no US until age assurance exists | Apple "Age Assurance" |
| 3 | Social Media answer | No | Apple rating 13+ if Yes |
| 4 | Apple override to a higher rating | None | Visibility on phones with Screen Time limits |
| 5 | IARC "Shares Info" | No, counsel to confirm | Adds a notice only |
