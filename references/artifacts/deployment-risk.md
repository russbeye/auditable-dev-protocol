**Output: Deployment Risk Statement**
```
## Deployment Risk Statement
**Known unknowns at ship time:** [→ Decision Log OPEN items]
**Monitoring targets:**
| Assumption | Signal that it was wrong | Threshold | dl_ref |
|------------|--------------------------|-----------|--------|
| ...        | ...                      | ...       | DL-XXX |
**Rollback trigger conditions:**
- [ ] [specific, observable condition] → rollback
**Staged rollout:** [YES / NO — if NO, justify]

dl_ref: the Decision Log entry holding the assumption. The signal and threshold in the row come from
that entry's Monitoring signal, authored at the Pre-Mortem or on the entry itself — this table
consumes signals, it does not invent them.
```
