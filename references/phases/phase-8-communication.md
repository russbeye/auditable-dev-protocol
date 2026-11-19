## Phase 8: Communication

**Do:** Before deploying, document the known unknowns at ship time, what monitoring should catch if
an assumption was wrong, and explicit rollback triggers.

**Gate:** Rollback trigger conditions are defined before deployment. "We'll know if something is
wrong" is not a trigger condition; name the observable signal and threshold.
