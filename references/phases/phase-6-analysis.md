## Phase 6: Analysis

**Do:** Write tests to falsify, not to confirm. Then list what passing tests do not prove:

- The untestable assumptions.
- The scenarios that tests cannot reach.
- The conditions under which the code can be wrong despite green CI.

**Gate:** The Test Adversary Document exists before the PR opens. A PR without the Test Adversary
Document is missing its analysis phase.
