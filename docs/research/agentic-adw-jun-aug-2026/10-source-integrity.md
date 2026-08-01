# Source integrity report (adversarial cross-check)

**Integrity pass:** 2026-08-02  
**Freeze close-out pass:** 2026-08-02 (self-driving/cloud fill + quiet re-fetch)  
**Authoritative IDs:** [`00-source-inventory.md`](./00-source-inventory.md) — prefer **URL+date** over bare S-IDs when conflicting.  
**Product audit:** [`08-audit-findings.md`](./08-audit-findings.md) — separate.

## Freeze verdict

**YES — freeze-ready** as a dated research reference for a later VYOTIQ codebase audit, **provided** readers:

1. Treat the pack title as **ADW framing (≈ Jul 2026) + still-governing earlier-2026 lab primaries**, not “everything published Jun–Aug.”  
2. Use [`00-source-inventory.md`](./00-source-inventory.md) as the ID map; cite URL+date in prose when unsure.  
3. Prefer live `src/main/agent/**` over any mapping doc when they disagree.

### Freeze checklist

| Item | Result |
|------|--------|
| Core ADW claims (S1/S2 + YouTube) verified | **PASS** |
| Core lab claims (OpenAI / Cursor / Claude / MCP) verified against live URLs | **PASS** |
| Window overstatement corrected in README / `02` / inventory | **PASS** |
| Quiet re-fetch of previously intermittent URLs | **PASS** (all **REACHABLE**; none **DEAD**) |
| Self-driving + cloud VM isolation filled with URL+date (`05`, `02`) | **PASS** |
| Thin topics filled or explicitly **DEFERRED** | **PASS** |
| Orphan S-IDs removed from `01` / tool-loop summary | **PASS** |
| No product/agent code changes in this integrity work | **PASS** |
| August 2026 dated deep-dives complete | **DEFERRED** (documented sparse; not a freeze blocker) |
| Agents SDK universal max-turn/retry N | **DEFERRED / UNVERIFIED** (documented in `05` / `11`) |
| S23 Cursor agent-best-practices first-publish date | **UNVERIFIED** (content verified; first-publish date not pinned) |

---

## VERIFIED claims (selected; full URLs)

| Claim | URL | Date |
|-------|-----|------|
| ADW > loop engineering; three actors | https://www.youtube.com/watch?v=VQy50fuxI34 · https://openclawdatabase.com/news/videos/2026-07-13-ai-developer-workflows/ | ≈ 2026-07-13 |
| Harness / AGENTS.md TOC / mechanical gates | https://openai.com/index/harness-engineering/ | 2026-02-11 |
| Planner/worker; flat coord failed | https://cursor.com/blog/scaling-agents | 2026-01-14 |
| Self-driving research: planner/subplanner/worker; remove integrator | https://cursor.com/blog/self-driving-codebases | ≈ Jan–Feb 2026 |
| Cloud VM + computer use; artifacts; remote desktop | https://cursor.com/blog/agent-computer-use · https://cursor.com/changelog/02-24-26 | **2026-02-24** |
| Cloud lessons: env as product; durable runs; computer-use subagent | https://cursor.com/blog/cloud-agent-lessons | ≈ late Jul 2026 |
| Swarm economics (frontier planner / cheap workers) | https://cursor.com/blog/agent-swarm-model-economics | **2026-07-20** (related-strip) |
| Claude layering / hooks / memory / worktrees / permissions | claude.com blog + code.claude.com docs | May–Jul 2026 + live |
| MCP OAuth audience / no passthrough | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations | 2026-07-28 |
| Anthropic AI-native SDLC security | https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle | **2026-07-21** |

---

## WEAK (accepted, documented)

| Issue | Handling |
|-------|----------|
| Pack folder name contains “jun-aug” | Caveats in README / `02` / this file — do not read as publication window for all rows |
| S5 / cloud-agent-lessons / self-driving page undated | Dates from related-strips / changelog / sequencing; labeled as such |
| S23 first-publish | Living guide; first-publish **UNVERIFIED** |

---

## FALSE / unsupported (struck)

| Item | Action |
|------|--------|
| Implying Jan–May lab essays are Jun–Aug publications | Corrected with **outside** labels |
| Orphan S20/S22/S30/S32/S40 in early drafts | Struck; inventory S20–S29 are the authoritative set |

---

## DEFERRED topics (explicit)

| Topic | Reason |
|-------|--------|
| August 2026 dated deep-dives | Sparse as of 2026-08-02; prefer July + living docs |
| Agents SDK numeric max-turn / retry defaults | No verified universal N |
| Dedicated entropy/GC-agent playbook | Covered via S3 / `03`; no separate section required |
| VYOTIQ cloud VM / worktree product | Out of product scope for this package (`05`) |

---

## URL reachability (quiet pass 2026-08-02)

| Status | URLs |
|--------|------|
| **REACHABLE** | All core bibliography primaries in `sources.md` checked this pass, including previously intermittent MCP auth, Anthropic SDLC, Cursor worktrees, OpenAI Running agents, self-driving, computer-use, cloud-agent-lessons, changelog 02-24-26 |
| **INTERMITTENT** | None remaining after quiet pass (earlier timeouts cleared) |
| **DEAD** | None found among core primaries |

---

## Key self-driving / cloud findings (for parent)

1. **Research** ([self-driving-codebases](https://cursor.com/blog/self-driving-codebases)): planner/subplanner/worker with handoffs; flat self-coord and integrator both failed; research throughput ≠ product default.  
2. **Product** ([agent-computer-use](https://cursor.com/blog/agent-computer-use) **2026-02-24**): per-agent isolated VM, validate in-sandbox, PR + artifacts, remote desktop.  
3. **Ops lessons** ([cloud-agent-lessons](https://cursor.com/blog/cloud-agent-lessons) ≈ late Jul): full env quality dominates; durable execution; computer-use as harness subagent; autonomy prompts differ for cloud vs local.

---

## Relationship to other pack docs

- `08` / `09` = product/runtime — not source integrity.  
- `11` = tool-loop behaviours — cite URL+date.  
- Mapping for audits: `07` + live code.
