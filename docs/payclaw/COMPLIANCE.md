# PayClaw Compliance (Canonical)

Single source of truth for 10DLC, consent, prohibited content, and attestation. Creators and the swarm must use this; do not invent new categories or wording.

## 10DLC brand and campaign

- **Required for A2P long-code SMS in the US.** One PayClaw umbrella brand/campaign covers all numbers; merchants do not register their own.
- **Brand:** Business legal name, DBA, EIN, address, contact, website. Sample use-case: “Sending invoice payment reminders for [Business], encouraging prompt payment within 45 days.”
- **Campaign type:** Low Volume Mixed or Customer Care. Use case: **Account Notifications**.
- **Sample messages:** Must be provided; use the locked templates in `config/payclaw/message-templates.txt`. Confirm no prohibited content (debt collection, loans, gambling, cannabis, etc.).

## Consent and opt-out

- **Consent:** Require explicit attestation at onboarding: user confirms they have permission to send invoice reminders (not debt collections) and that they will only contact recipients who have consented or have an existing business relationship for the invoice.
- **Opt-out:** Every SMS must include “Reply STOP to unsubscribe.” Telnyx handles STOP/HELP; you must also remove the number from future sends and store opt-outs. Emails must include an unsubscribe link.
- **Logs:** Maintain logs of consent, messages sent, and opt-outs for compliance and audits.

## Prohibited content and industries

- **Prohibited content (carriers will reject):** Debt collection, credit repair, payday/title loans, gambling, alcohol, tobacco, cannabis, hate speech, firearms, adult content, political campaigns, etc.
- **Business-type handling:** Use `config/payclaw/risk-categories.json`. **Low risk** (e.g. home services, retail, SaaS): auto-approve. **Medium risk** (e.g. legal, real estate): manual review. **High risk / auto-reject:** Third-party debt collectors, medical debt recovery, payday lending, pawn shops, political campaigns, MLMs, etc. Do not allow high-risk industries to onboard.

## Attestation wording (onboarding)

User must confirm (checkbox + timestamp):

- “I am collecting payment for **invoices for services or goods rendered directly by my business**, and I am **not** collecting on behalf of third parties or for debt purchased or assigned.”
- “Invoice ages are **under 45 days** from the date of service or delivery.”
- “I have **consent or a legitimate business relationship** to contact the recipients for this invoice.”
- “I will not use PayClaw for debt collection, credit repair, payday lending, gambling, or other prohibited uses.”

Store attestation with timestamp and business type selected.

## Data and privacy

- Comply with GDPR/CCPA where relevant: privacy notice, limit use to legitimate interests (invoice collection), secure storage. Offer Data Processing Agreement for EU customers if applicable.
