---
name: api-design
description: Use when designing or changing HTTP/IPC/SDK APIs, schemas, or client contracts.
version: 1.0.0
---

# API design

When designing or changing APIs:

1. Prefer explicit, stable contracts; avoid ambiguous optional fields.
2. Match existing naming, error shapes, and versioning in the project.
3. Document breaking changes and migration paths clearly.
4. Validate inputs at the boundary; return actionable errors.
5. Keep auth and tenancy rules consistent with neighboring endpoints.
6. Prefer additive evolution over silent behavior changes.
7. Provide a minimal example request/response when introducing something new.
