# Effects and do-not

## When existing caches work

- **Provider prompt cache:** Lower input cost and TTFT on multi-step runs with a stable harness/tools prefix (S1–S3).  
- **Short TTL + invalidate (git status, run list, snapshot):** Fewer redundant shell/FS scans without long-lived wrong state.  
- **Model catalog RAM+disk:** Faster composer model lists across restarts; generation token prevents stale inflight overwrite.  
- **Stable system-prefix fingerprint:** CPU saved across steps without baking clock/snapshot into the durable prefix.

## When they fail

- **Stale gitignore matcher:** `list_dir` / walk / search can hide or show wrong paths after `.gitignore` changes until process restart → agent acts on wrong tree view.  
- **Stale git/snapshot without invalidate:** Context and UI disagree with disk (tools already invalidate on mutations — keep that discipline).  
- **Unstable prompt prefix:** Repeated cache *writes*, few *reads*, higher cost with little latency win (S1 GPT-5.6 write pricing).  
- **Caching secrets or cross-workspace answers:** Security / correctness incident — not done today; do not add.

## Do not (product)

- Add Redis / Valkey / shared remote cache layers.  
- Add semantic or final-answer memoization across turns/users.  
- Add a new “cache framework” or multi-tier agent cache product.  
- Add tool-result memoization systems that do not already exist.  
- Put timestamps or per-step env into the **stable** assemble fingerprint.  
- Grow MCP tool JSON mid-run unless necessary (provider miss is expected when you do).

## Recommended stance

Harden **existing** invalidation and tests. Prefer deleting incorrect cache entries over adding new stores.
