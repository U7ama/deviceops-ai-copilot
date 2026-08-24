# Failure lab

These are exercises to run and explain before making portfolio claims. Each should leave an observable event, metric, audit entry, or safe error.

| Exercise | Expected control |
| --- | --- |
| Kill the worker after `run.accepted` | Outbox recovery republishes the job; singleton key prevents a second diagnosis. |
| Submit the same run key twice | The same run is returned; a different request under that key is `409`. |
| Read an Alpha run from Beta | RLS plus application scope returns `404`, not data. |
| Technician approves own proposal | `403`; no incident or state transition. |
| Replay the same approval | `409`; one incident and one command key remain. |
| Corrupt a citation ID or offset | Safe fallback diagnosis; no invalid citation is streamed. |
| Make status timeout or stale | Manual evidence remains visible with freshness limitation. |
| Put injection text in a manual chunk | Signal is recorded and chunk is excluded from usable citations. |
| Send an old/bad-HMAC n8n envelope | `401`; no delivery or incident transition. |
| Deliver the same signed webhook twice | Delivery id/nonce uniqueness makes the second request a no-op. |
| Upload EICAR or an unallowlisted fixture | `rejected` or `quarantined`; never attachable to a run. |
| Delete media while a job is queued | Tombstone and state check prevent the worker reading it. |
| Restore a backup into a disposable database | Migrations, seed, RLS checks, and runbook must reproduce the smoke gate. |

The acceptance evidence should record the command, commit, dataset, outcome, and limitation.
