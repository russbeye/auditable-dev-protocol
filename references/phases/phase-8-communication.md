## Phase 8: Communication

**Do:** Before deployment, document three things:

- The known unknowns at ship time.
- What monitoring should catch if an assumption was wrong.
- Explicit rollback triggers.

**Gate:** Define the rollback trigger conditions before deployment. "We'll know if something is
wrong" is not a trigger condition. Name the observable signal and its threshold.
