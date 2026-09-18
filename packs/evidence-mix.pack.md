=== ADP PACK evidence-mix/v1 · {{index.generated}} ===
corpus: {{index.project}} · {{ticket_count}} tickets · open decisions by confidence basis
direct evidence {{basis_counts.direct}} · inference from convention {{basis_counts.inference}} · developer assertion {{basis_counts.assertion}} · other {{basis_counts.other}} · no basis stated {{basis_counts.none}}

ON DEVELOPER ASSERTION
{{#basis_assertion}}- {{tid}} {{id}} [{{confidence}}] {{title}}
{{/basis_assertion}}{{^basis_assertion}}- none
{{/basis_assertion}}
ON INFERENCE FROM CONVENTION
{{#basis_inference}}- {{tid}} {{id}} [{{confidence}}] {{title}}
{{/basis_inference}}{{^basis_inference}}- none
{{/basis_inference}}
ON A BASIS OF ANOTHER KIND
{{#basis_other}}- {{tid}} {{id}} [{{confidence}}] {{title}}
{{/basis_other}}{{^basis_other}}- none
{{/basis_other}}
WITH NO BASIS STATED
{{#basis_none}}- {{tid}} {{id}} [{{confidence}}] {{title}}
{{/basis_none}}{{^basis_none}}- none
{{/basis_none}}
A basis is classified by its leading phrase. An assertion rests on one
person's word: confirm it with that person or find the evidence. An
inference rests on a convention: name where the record states it, or record
the weaker footing in a dated status note; a changed decision is a new entry
whose Supersedes field names the old one. An entry with no basis predates
the field or skipped it: add a dated status note that names one. Direct
evidence needs no action here; its count is the corpus's calibration base.
=== END PACK ===
