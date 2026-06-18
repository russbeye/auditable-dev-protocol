# Auditable AI-Assisted Development Protocol

A nine-phase protocol for AI-assisted development. Under it, the model defends one recommendation, logs every assumption with its confidence, and leaves traceable artifacts. Use it when defensibility matters more than speed, on work that is hard to reverse.

## What's inside

- `SKILL.md`: the full protocol, its phase gates, and the artifact each phase produces.
- `prompts/prompt-template.yaml`: a YAML format for framing a request before you start. Copy it and fill it in.
- `references/prompt-template-annotated.yaml`: the same template, documenting every field and option.
- `references/failure-modes.md`: maps a symptom to the artifact you open first when something breaks.
- `scripts/validate-prompt.py`: checks a filled prompt for structure, types, and allowed values.

## Using the protocol

Invoke the skill by name, or ask for any of its artifacts. Reach for it before migrations, auth changes, payments, destructive operations, or public API changes. Skip it for renames and one-liners.

A YAML-based prompt template is provided for structured prompting to ensure consistent and comprehensive results. While the template is the preferred way to use this skill, it will accept any prompting method you choose.

## Using the prompt template

1. Copy `prompts/prompt-template.yaml` to wherever your task lives.
2. Fill in the role, the ask, the constraints, the context, the output, and the requirements. Delete the sections you do not need.
3. Set `protocol.artifacts` to the documents you want produced. The annotated reference lists every option.
4. Validate it:

   ```
   python3 scripts/validate-prompt.py your-prompt.yaml
   ```

   The script prints each problem it finds and exits non-zero. A clean run prints `VALID`.

Invoke the skill with a request in hand and it offers to draft a filled template from what you gave it. Tell it where to save the file.
