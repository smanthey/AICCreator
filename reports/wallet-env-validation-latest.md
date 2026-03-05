# Wallet Repo Env Validation

Generated: 2026-03-04T03:52:38.503Z
Root: /Users/tatsheen/claw-repos

| Repo | Score | Env Keys | PassKit Route Coverage | Cert Artifacts |
|---|---:|---|---:|---|
| SomaveaChaser | 32 | none | 4 | no |
| CookiesPass | 76 | APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_APNS_KEY_ID | 4 | yes |
| TempeCookiesPass | 76 | APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_APNS_KEY_ID | 4 | yes |
| booked | 64 | APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_APNS_KEY_ID, APPLE_APNS_KEY_PATH | 4 | no |
| capture | 32 | none | 4 | no |
| Inbound-cookies | 32 | none | 4 | no |
| FoodTruckPass | 52 | none | 4 | yes |

## Detailed Gaps

### SomaveaChaser
- Missing env keys: APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_APNS_KEY_ID, APPLE_APNS_KEY_PATH, PASSKIT_AUTH_TOKEN
- Route hits: 4
- Cert hints: none found
### CookiesPass
- Missing env keys: APPLE_APNS_KEY_PATH, PASSKIT_AUTH_TOKEN
- Route hits: 4
- Cert hints: attached_assets: Certificates_1770405779909.p12
### TempeCookiesPass
- Missing env keys: APPLE_APNS_KEY_PATH, PASSKIT_AUTH_TOKEN
- Route hits: 4
- Cert hints: attached_assets: Certificates_1770405779909.p12
### booked
- Missing env keys: PASSKIT_AUTH_TOKEN
- Route hits: 4
- Cert hints: none found
### capture
- Missing env keys: APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_APNS_KEY_ID, APPLE_APNS_KEY_PATH, PASSKIT_AUTH_TOKEN
- Route hits: 4
- Cert hints: none found
### Inbound-cookies
- Missing env keys: APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_APNS_KEY_ID, APPLE_APNS_KEY_PATH, PASSKIT_AUTH_TOKEN
- Route hits: 4
- Cert hints: none found
### FoodTruckPass
- Missing env keys: APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_APNS_KEY_ID, APPLE_APNS_KEY_PATH, PASSKIT_AUTH_TOKEN
- Route hits: 4
- Cert hints: server/certs: AppleWWDRCAG4.cer, AuthKey_T2UWD4B997.p8, Certificates.p12, pass.cer | attached_assets: AppleWWDRCAG4_1770336689597.cer, AuthKey_T2UWD4B997_1770336689597.p8, Certificates_1770336689597.p12
