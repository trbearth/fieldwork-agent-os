# Security policy

## Secrets

Store local credentials only in `.env.local`, which is ignored by Git. Use encrypted repository secrets for scheduled workflows. Never use a `NEXT_PUBLIC_` prefix for server credentials.

If a credential is committed, revoke it at the provider immediately, remove it from repository history, and rotate any related credentials.

## Source access

Contributions must use public feeds or documented APIs under terms that permit the intended use. Connectors must not bypass logins, paywalls, robots controls, rate limits, platform review, or access restrictions.

Optional and gated connectors should fail closed. A missing credential must not cause another connector to attempt scraping as a fallback.

## Reports

Avoid personal data. Do not include full article text, private posts, access tokens, cookies, raw user audio, facial analysis, or body analysis. Keep citations, retrieval timestamps, and uncertainty visible.

## Reporting a vulnerability

Do not open a public issue containing an active secret or exploit. Contact the repository owner privately through the security-reporting option configured on GitHub.
