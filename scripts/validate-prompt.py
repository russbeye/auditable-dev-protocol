#!/usr/bin/env python3
"""Validate a filled prompt against the auditable-dev-protocol template structure.

Usage:
    python3 validate-prompt.py path/to/prompt.yaml

Exit codes:
    0  valid
    1  invalid (problems listed on stdout)
    2  usage error, missing file, unparseable YAML, or missing PyYAML
"""
import sys

try:
    import yaml
except ImportError:
    print("error: PyYAML is required (pip install pyyaml)", file=sys.stderr)
    sys.exit(2)

OUTPUT_FORMATS = {"code", "patch", "json", "yaml", "markdown", "prose"}
ARTIFACTS = {
    "problem_statement",
    "knowledge_gap",
    "recommendation_brief",
    "premortem",
    "decision_log",
    "test_adversary",
    "pr_summary",
    "deployment_risk",
    "obligation_tickets",
}


def nonempty_str(value):
    return isinstance(value, str) and value.strip() != ""


def validate(doc):
    errors = []

    def require(cond, msg):
        if not cond:
            errors.append(msg)

    if not isinstance(doc, dict):
        return ["root must be a mapping"]

    require(doc.get("schema_version") == "1.0", 'schema_version must be "1.0"')

    task = doc.get("task")
    require(isinstance(task, dict), "task must be a mapping")
    if isinstance(task, dict):
        for key in ("id", "title", "author", "date"):
            require(nonempty_str(task.get(key)), f"task.{key} must be a non-empty string")

    role = doc.get("role")
    require(isinstance(role, dict), "role must be a mapping")
    if isinstance(role, dict):
        require(nonempty_str(role.get("lens")), "role.lens must be a non-empty string")
        if "priorities" in role:
            require(isinstance(role["priorities"], list), "role.priorities must be a list")

    require(nonempty_str(doc.get("prompt")), "prompt must be a non-empty string")

    out = doc.get("output")
    require(isinstance(out, dict), "output must be a mapping")
    if isinstance(out, dict):
        require(
            out.get("format") in OUTPUT_FORMATS,
            f"output.format must be one of {sorted(OUTPUT_FORMATS)}",
        )
        require(nonempty_str(out.get("destination")), "output.destination must be a non-empty string")

    reqs = doc.get("requirements")
    require(isinstance(reqs, list) and len(reqs) >= 1, "requirements must be a non-empty list")
    if isinstance(reqs, list):
        for i, item in enumerate(reqs):
            if not isinstance(item, dict):
                errors.append(f"requirements[{i}] must be a mapping")
                continue
            for key in ("id", "statement", "verify"):
                require(nonempty_str(item.get(key)), f"requirements[{i}].{key} must be a non-empty string")

    proto = doc.get("protocol")
    require(isinstance(proto, dict), "protocol must be a mapping")
    if isinstance(proto, dict):
        require(isinstance(proto.get("apply"), bool), "protocol.apply must be a boolean")
        for key in ("stake_single_recommendation", "log_assumptions", "flag_low_confidence"):
            if key in proto:
                require(isinstance(proto[key], bool), f"protocol.{key} must be a boolean")
        artifacts = proto.get("artifacts", [])
        require(isinstance(artifacts, list), "protocol.artifacts must be a list")
        if isinstance(artifacts, list):
            for value in artifacts:
                require(value in ARTIFACTS, f"protocol.artifacts has unknown value: {value!r}")

    if "preamble" in doc:
        require(isinstance(doc["preamble"], str), "preamble must be a string")

    if "constraints" in doc:
        require(isinstance(doc["constraints"], dict), "constraints must be a mapping")

    if "context" in doc:
        require(isinstance(doc["context"], dict), "context must be a mapping")

    if "lessons_learned" in doc:
        lessons = doc["lessons_learned"]
        require(isinstance(lessons, list), "lessons_learned must be a list")
        if isinstance(lessons, list):
            for i, item in enumerate(lessons):
                ok = isinstance(item, dict) and nonempty_str(item.get("context")) and nonempty_str(item.get("takeaway"))
                require(ok, f"lessons_learned[{i}] must have non-empty context and takeaway")

    return errors


def main():
    if len(sys.argv) != 2:
        print("usage: validate-prompt.py path/to/prompt.yaml", file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]
    try:
        with open(path) as handle:
            doc = yaml.safe_load(handle)
    except (OSError, yaml.YAMLError) as exc:
        print(f"error: could not read or parse {path}: {exc}", file=sys.stderr)
        sys.exit(2)

    errors = validate(doc)
    if errors:
        print(f"INVALID: {path}")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)

    print(f"VALID: {path}")
    sys.exit(0)


if __name__ == "__main__":
    main()
