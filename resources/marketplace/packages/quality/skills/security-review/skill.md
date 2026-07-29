---
name: security-review
description: Use when reviewing code or changes for security, auth, secrets, and data-handling risks.
version: 1.0.0
---

# Security review

When reviewing for security:

1. Prioritize authz/authn gaps, injection, XSS, SSRF, path traversal, and secret leakage.
2. Check how untrusted input reaches parsers, shells, SQL, HTML, and network calls.
3. Flag secrets, tokens, and PII in logs, commits, or client bundles.
4. Note unsafe defaults (open CORS, weak crypto, missing validation).
5. Suggest concrete mitigations tied to the code paths involved.
6. Distinguish confirmed issues from speculative risks.
7. Ask 1–2 clarifying questions only when threat model or trust boundaries are unclear.
