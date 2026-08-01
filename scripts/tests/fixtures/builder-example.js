/* The builder's example document, in the state shape gather() produces. This
   mirrors the EXAMPLE object in scripts/prompt-builder.html. If that example
   changes, update this file to match, then regenerate the golden output from
   the repo root and review the diff before committing:

     node -e "const l=require('./scripts/adp-prompt-lib.js'),s=require('./scripts/tests/fixtures/builder-example.js');require('fs').writeFileSync('scripts/tests/fixtures/builder-example.yaml',l.buildYaml(s))"
*/
"use strict";

module.exports = {
  task: {
    id: "GROW-6687-email-validation",
    title: "Add server-side validation to the signup email field",
    author: "rbeye",
    date: "2026-06-18"
  },
  preamble: "Ignore prior memories about the visual config builder.\nAssume the reader knows the signup runtime, not the builder.",
  role: {
    lens: "Staff engineer accountable for data integrity",
    priorities: [
      "Reject invalid input before it reaches the database",
      "Keep the change small and reversible"
    ]
  },
  prompt: "Validate the signup email on the server so malformed addresses are rejected\nwith a 422 and a clear message, instead of being stored.",
  constraints: {
    out_of_scope: [
      "Client-side validation changes",
      "Email deliverability or verification mail"
    ],
    must_not: ["Change the public signup API response shape"]
  },
  context: {
    background: "Signup currently trusts the client to validate. Bad addresses reach the users table.",
    references: [
      {
        path: "src/signup/handler.ts",
        lines: "42-88",
        note: "Where the request body is parsed and persisted"
      }
    ],
    links: ["https://example.atlassian.net/browse/GROW-6687"]
  },
  lessons_learned: [
    {
      context: "A regex-only check was tried before",
      takeaway: "It rejected valid plus-addressed emails; use a parser, not a regex"
    }
  ],
  output: {
    format: "patch",
    destination: "Edit files in place",
    structure: "A minimal diff to src/signup/handler.ts plus one test file.\nName each file and the functions touched."
  },
  requirements: [
    {
      id: "R1",
      statement: "A malformed email returns 422 and is not persisted",
      verify: "Integration test posts a bad address and asserts 422 plus no new row"
    }
  ],
  protocol: {
    apply: true,
    stake_single_recommendation: true,
    log_assumptions: true,
    flag_low_confidence: true,
    artifacts: ["decision_log", "test_adversary"]
  }
};
