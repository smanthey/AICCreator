# PayClaw workflow (product scope)

Canonical workflow for creators implementing PayClaw. Follow compliance and locked templates.

## 1. Onboarding

User subscribes, installs DMG. App prompts Stripe Connect (create/connect account); PayClaw stores account ID and platform fee. User signs ToS: invoice payment only, invoices under 45 days, consent to contact; business-type selection and attestation per `docs/payclaw/COMPLIANCE.md`.

## 2. Phone & 10DLC

App provisions Telnyx number from master account. One PayClaw umbrella brand/campaign; sample compliant messages per `config/payclaw/message-templates.txt`. Store brand/campaign and compliance copy.

## 3. Summary dashboard and list entry (required)

The program **must** include a **summary dashboard** where the user can:

- **Upload** the list (e.g. CSV): debtors/invoices — name, email, phone, invoice number, amount, due date, description.
- **Manually add** entries to the list.

The dashboard should show a **summary** of the list (counts, status), support **validate**, **dedupe**, and **invalid-number** handling (e.g. queue or flag). Later steps use this list for messaging and payment links.

## 4. Message flow

On due/send day: build email and SMS from locked templates. Email: subject/body per message-templates; SMS: template with STOP. Payment link = Stripe Checkout/Payment Link on merchant’s connected account. Fixed send rate; queue in tasks; track success/failure.

## 5. Payment

Customer pays via link; funds to merchant; PayClaw fee via Connect. Webhooks update invoice status and logs; trigger follow-up if unpaid.

## 6. Compliance

Telnyx STOP/HELP handling; store opt-outs; email unsubscribe link; logs for consent and messages.

## 7. Reporting

Dashboard: invoice statuses, success rates, payments collected, fees; **export for audits**.
