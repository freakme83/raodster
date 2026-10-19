# AIRSHIFT agent workflow

## Implementation tasks

For implementation tasks, the main Codex agent acts as coordinator and follows this workflow:

1. Delegate codebase investigation to the `analyst` subagent.
2. Pass relevant analyst findings to the `developer` subagent for the scoped implementation.
3. Delegate independent verification of the implementation to the `reviewer` subagent.
4. If the reviewer finds a blocking issue, send the findings to the developer for correction and repeat the review. Allow at most two correction cycles.
5. Present a final report covering changes, tests, risks, and the review outcome.

Use the actual configured subagents for each stage. If a required subagent is unavailable, report that clearly; do not simulate its work.

## Safety and scope

- Use `prod-ready` as the development base. Never modify `main`.
- Never commit, push, merge, deploy, or open a pull request without explicit authorization.
- Preserve AIRSHIFT gameplay invariants, including physics, difficulty progression, traffic fairness, deterministic generation, and collision behavior, unless explicitly instructed otherwise.
- Keep changes narrowly scoped to the assigned task.
- For read-only requests, do not invoke the `developer` subagent unnecessarily.
