## Phase 6: Analysis

**Do:** Write tests to falsify, not to confirm. Then enumerate what passing tests do not prove: the
untestable assumptions, the scenarios tests cannot reach, the conditions under which the code could
be wrong despite green CI.

**Gate:** The Test Adversary Document exists before the PR is opened. A PR without it is missing its
analysis phase.
