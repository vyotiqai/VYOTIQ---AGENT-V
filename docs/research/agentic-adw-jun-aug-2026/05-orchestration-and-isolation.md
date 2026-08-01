# Orchestration and isolation

**Research pass:** 2026-08-02  
**Sources:** S3, S4, S5, S9 (sandbox), S15 (Cursor worktrees), S16 (Claude worktrees/agents).

## Planner / worker (Cursor — Verified primary)

[Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents):

- Flat multi-agent self-coordination via shared file + locks **failed** (lock hold/forget, bottleneck, brittleness). Optimistic concurrency helped but risk aversion remained.  
- **Planners** explore + create tasks; may spawn **sub-planners** (recursive planning).  
- **Workers** execute leaf tasks; no peer coordination / no big-picture duty; push when done.  
- End-of-cycle **judge** decides continue vs fresh start (combat tunnel vision).  
- Removed **integrator** role — created more bottlenecks than it solved.  
- **Model-per-role** beats one universal model.  
- Right structure is **middle**: too little → conflict/drift; too much → fragility.  
- Harness + models matter; Cursor states **prompts matter more** for long coordination (same post).

[Agent swarms and the new model economics](https://cursor.com/blog/agent-swarm-model-economics):

- Tasks as trees; planner = frontier model, worker = cheaper/faster → similar quality, large cost variance.  
- Suspected win is **context efficiency** (planner never implements; worker never plans), not only parallelism.  
- Research swarm hit extreme commit rates; Cursor built a **custom VCS** for that regime — **research artifact**, not a product requirement for typical apps.  
- Failure modes documented: split-brain design, planner contention, merge conflicts, megafiles, ossification — mitigations via prompts, shared design docs, neutral merge agent, file decomposition, intentional-breakage licensing.  
- **Stacked review lenses** (decorrelated reviewers).

## Worktrees = default FS isolation (Verified primary — 2026 product docs)

### Cursor

[Worktrees docs](https://cursor.com/docs/configuration/worktrees) (Agents Window + IDE skills):

- Each agent/task gets isolated Git checkout; main checkout untouched.  
- `.cursor/worktrees.json` setup hooks (`setup-worktree`, OS-specific); `$ROOT_WORKTREE_PATH` for env copy. Prefer fast package managers over symlinking `node_modules`.  
- Cleanup: `cursor.worktreeMaxCount` default **25** machine-wide; interval cleanup.  
- IDE: `/worktree` one isolated run; `/best-of-n` same prompt × models × **one worktree each**; apply via `/apply-worktree` — compare only, no auto-merge.

### Claude Code

[Worktrees](https://code.claude.com/docs/en/worktrees) + [Agents parallel](https://code.claude.com/docs/en/agents) + [Sub-agents](https://code.claude.com/docs/en/sub-agents):

- `claude --worktree <name>` → checkout under `.claude/worktrees/`; desktop app: new session → worktree automatically.  
- Subagents: frontmatter `isolation: worktree` → temporary worktree; auto-remove if clean; lock while running.  
- Base branch: `worktree.baseRef` `"fresh"` (default remote default branch) vs `"head"` (current HEAD for in-progress isolation).  
- `.worktreeinclude` copies selected gitignored files (e.g. `.env`) into new worktrees.  
- Parallel modes compared: **subagents** (delegated, summary return), **agent view / sessions**, **agent teams** (experimental; **no** automatic worktree isolation — partition files manually), **`/batch`** skill (5–30 worktree-isolated subagents → PRs).  
- Non-git VCS: `WorktreeCreate` / `WorktreeRemove` hooks.

### OpenAI Codex / harness

[Harness engineering](https://openai.com/index/harness-engineering/) (2026-02-11): **app bootable per git worktree**; ephemeral observability stack per worktree (logs/metrics torn down with task). Worktree isolation is prerequisite for parallel Codex runs on one repo.

## Sandboxes (beyond worktrees)

| System | What is isolated | Cite |
|--------|------------------|------|
| Cursor local sandbox | Shell under OS primitives (macOS Seatbelt, Linux Landlock+seccomp, Windows via WSL2); free inside; approve to leave (often network); reduces stops ~40% vs unsandboxed | [Agent sandboxing](https://cursor.com/blog/agent-sandboxing) (2026-02-18 related-strip) |
| Cursor cloud agents | Dedicated VM per agent; onboard + merge-ready PRs with video/screenshot/log artifacts; remote desktop handoff | [Agent computer use](https://cursor.com/blog/agent-computer-use) (**2026-02-24**; changelog same day) |
| OpenAI | Isolated cloud sandbox + local worktrees; approval for risky/network | Prefer OpenAI primary where available (S3 / App Server) |
| Claude Code | Sandboxing docs linked from worktrees; FS isolation complementary to worktrees | [worktrees](https://code.claude.com/docs/en/worktrees) |

**Verified practice:** worktrees solve **file collision**; OS sandboxes/VMs solve **blast radius / network / secrets**; neither replaces **CI/test gates**.

## Self-driving research → cloud product (Cursor — Verified primary)

### Research harness ([Towards self-driving codebases](https://cursor.com/blog/self-driving-codebases), ≈ Jan–Feb 2026; follow-up to [scaling-agents](https://cursor.com/blog/scaling-agents) **2026-01-14**)

Dense findings (evidence only):

- Flat equal-role self-coord via shared lock file **failed** (lock misuse, contention, risk aversion).  
- Intermediate designs: upfront planner → executor → workers + judge; then continuous executor (too many roles → pathological sleep/premature completion).  
- **Final research design:** root **planner** (no coding; recursive **subplanners**) + **workers** on their own repo copies with a single handoff upward; removed **integrator** bottleneck.  
- Throughput tradeoffs explicit: not requiring 100% commit correctness every push; periodic reconciliation; research peaked ~1,000 commits/hour over a week.  
- **Not** the shipping IDE default — research swarm / custom coordination; product isolation for users is worktrees + local/OS sandbox + cloud VMs.

### Cloud / VM product ([Agent computer use](https://cursor.com/blog/agent-computer-use) **2026-02-24**; lessons [cloud-agent-lessons](https://cursor.com/blog/cloud-agent-lessons) ≈ late Jul 2026)

- Each cloud agent: **isolated VM** with full env; iterate/build/test in-sandbox; artifacts for human review; trigger from web/mobile/desktop/Slack/GitHub.  
- Local agents compete for laptop resources; cloud VMs enable parallel unattended runs.  
- Lessons (Jul post): **dev environment is the product**; durable execution for long runs; decouple agent loop / machine / conversation state; computer-use as dedicated subagent (VNC/Chrome in env); prefer tools over hardcoding harness behavior; self-healing env (secrets/network) as roadmap.  
- ADW mapping: graduate isolation **worktree → OS sandbox → per-agent VM**; engineer role shifts toward direction + ship decisions.  
- **Out of scope for VYOTIQ this package:** building cloud VM fleet / Temporal-style durable cloud loops.

## Nested / parallel agents — vocabulary

| Term | Meaning (2026 labs) | Isolation |
|------|---------------------|-----------|
| Subagent | Child session, own context, returns summary | Optional worktree (`isolation: worktree`) |
| Nested planner | Planner spawns sub-planners | Usually logical + repo; Cursor research |
| Parallel sessions | Multiple user-facing agents | Worktrees (Cursor / Claude) |
| Agent team | Coordinated multi-session (Claude; experimental) | File partitioning; not auto-worktree |
| Best-of-n | Same task, multiple models | One worktree per candidate (Cursor) |
| Cloud agent | Remote VM clone | Strong sandbox + branch/PR |

## Branch isolation

- Worktree usually implies **own branch** (Claude: `worktree-<name>`; Cursor: separate checkout then commit/PR).  
- Conflicts deferred to **merge/PR time** — intentional (Augment/Zylos secondary; matches Cursor/Claude product design).  
- Cursor research swarm: hundreds of workers on **same branch** with custom VCS — **not** the shipping IDE default; do not treat as product best practice for VYOTIQ.

## ADW specialization (S1) vs lab reality

ADW: Scout → plan → build → test → review → ship; worktrees first; graduate to per-agent sandboxes.

Labs 2026: same isolation primitives; orchestration ranges from **shallow** (subagent depth 1–few) to **research swarm** / **cloud VM**. Middle structure + worktree isolation is the transferable pattern; full swarm/custom VCS and cloud fleets are not.

## DEFERRED (explicit)

| Topic | Why deferred |
|-------|----------------|
| OpenAI Agents SDK numeric max-turn / retry defaults | Docs describe loop + approval pause; **no verified universal N** in this pack (`11`) |
| Dedicated “entropy / background GC agent” playbook | Covered as OpenAI harness practice in S3 / `03`; no separate product-mapping section needed for freeze |
| August 2026 dated deep-dives | Sparse as of 2026-08-02 — prefer July changelogs + living docs (`02`) |

## VYOTIQ reality (preview — no product change)

- Nested/subagent depth hard-capped at **1** (`MAX_SUBAGENT_DEPTH`).  
- No factory router, no worktree-per-agent product, no hotfix race, no cloud VM agents.  
- Checkpoints + workspace sandbox paths: local write isolation.  
- Mapping: **Have** shallow nesting; **Missing** swarm/factory/cloud VM (out of scope); **Partial** vs lab OS sandboxes/worktrees.
