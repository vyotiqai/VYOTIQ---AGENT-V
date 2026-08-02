# ADW thesis and three actors

**Primary framing:** S1 (IndyDevDan transcript + [YouTube](https://www.youtube.com/watch?v=VQy50fuxI34)), S2 (OpenClawDatabase 2026-07-13 secondary).  
**Lab corroboration (not ADW vocabulary):** S3 (OpenAI harness), S6/S10/S14 (Claude layering / memory / hooks), S4 (Cursor scaling).  
**IDs:** Only IDs in [`00-source-inventory.md`](./00-source-inventory.md). Prefer URL+date if IDs conflict.

## Forget “loop engineering” as the headline

IndyDevDan (S1): “loop engineering” is a hype rebrand of the SDLC that names only conditional fail→retry edges. Naming every control-flow “\* engineering” does not scale. The useful unit is an **AI Developer Workflow (ADW)**: prompts enter a software factory; a workflow of **code + agents** runs; results exit.

S2 (2026-07-13) restates the same pipeline: plan → build → test → review → ship, executed by engineers, agents, and code — and labels itself analysis, not a how-to.

## Three actors

| Actor | Role | Reliability (S1/S2) |
|-------|------|---------------------|
| **Code** | Lint, format, typecheck, tests, routing, sandbox setup, ticket status | Highest — deterministic, free tokens, no hallucination |
| **Engineers** | Plan (prompt / intent) and review (validation / ship) | High judgment, scarce time |
| **Agents** | Specialized build/scout/test/hotfix workers inside the workflow | Powerful but least reliable alone |

Game of agentic engineering: place each actor correctly. Over-leveraging agents is called out as failure mode in S1 (“AI psychosis”).

### Lab echo (same idea, different words)

| Lab claim | Source | ADW mapping |
|-----------|--------|-------------|
| “Humans steer. Agents execute.” | S3 OpenAI harness engineering, **2026-02-11** | Engineer at meta layer; agents in middle |
| Hooks deterministic; skills advisory; CLAUDE.md is context not enforcement | S6 blog **2026-05-14**; S14 hooks; S10 memory | Code gates ≠ skill prose |
| Flat multi-agent self-coord failed; planner/worker; middle structure | S4 Cursor scaling, **2026-01-14** | Specialization without over-structure |
| Plan / Ask / Agent mode allowlists; Plan Mode waits for approval | Cursor agent best practices (S23); Claude permissions (S13) | Human gate between plan and implement |
| First dynamic workflow asks confirmation; agent finder does not auto-install | S19 **2026-05-28**; S25 **2026-06-17** | Human gates on expensive / capability wiring |

## Engineer constraints (human gates)

At scale, S1/S2 say engineers show up at **two ends**:

1. **Planning** — intent, prompt, workflow selection  
2. **Reviewing** — approve/reject, ship  

Exceptions: hotfixes and mid-pipeline HITL (S1). Meta-work targets the **agentic layer** (system that builds the system), not endless app-layer babysitting.

Vendor products operationalize those gates differently (plan approval, permission modes, workflow confirm, MCP install) — see [02-landscape](./02-landscape-jun-aug-2026.md).

## Separate agents from code

Do **not** bury lint/typecheck/test as the last lines of a skill the model might run (S1, S2). Run them as **code**; on failure, feed results back into the **same** build-agent session. Separation enables real guardrails and testable nodes.

Claude’s official guidance converges: hooks for must-run behavior; skills for on-demand procedures (S6, S14, S10). OpenAI’s harness-engineering writeup stresses mechanical docs/CI and worktree-legible apps so agents get enforceable feedback (S3).

## Growth path (document, don’t over-build)

From S1/S2:

1. Atom: engineer → agent → review  
2. Add deterministic lint gate → fail back to build agent  
3. Add format / typecheck / tests  
4. Optional dedicated test agent  
5. Plan → build → test → review → ship  
6. Isolation: worktrees → sandboxes  
7. Intake: tickets / factory router (specialized ADWs by chore/bug/feature/hotfix)

**KISS:** start with one build agent + one code gate; grow only when a real problem appears. Design by walking the workflow end-to-end first (mermaid / pencil) — S1/S2.

Cursor’s swarm research independently reports the same bias: many improvements came from **removing** integrator complexity; middle amount of structure beats both flat self-coord and over-structure (S4; economics detail in S5).

## What this is not

- Not vibe coding (unknown system) — S1.  
- Not “agents alone.”  
- Not a mandate to ship a kanban factory in every product — specialization is for *when* you scale (S1/S2).  
- Not a claim that vendor “harness” docs adopt the string “ADW” — they do not; ADW is S1 vocabulary mapped onto lab practices.
