# Project instructions

## Personal skills

- Personal skills are explicit-only. Preserve `policy.allow_implicit_invocation: false` in `agents/openai.yaml`.
- Skill explanation, editing, and installation requests do not authorize document operations.
- Do not carry a skill invocation into a separate later task.

## Commits

- Use Conventional Commit-style subjects: `feat:`, `fix:`, `docs:`, `test:`, `build:`, `chore:`.
- Keep code, documentation, tests, and build changes in meaningful scoped commits.

## Product and safety

- HWP Easy targets non-developers. Keep Python/pip/CLI setup in developer documentation, not as the promised normal user experience.
- Distinguish implemented capabilities from planned installer, GUI, and plugin distribution.
- Default to HWP-only. Generate PDF/DOCX only on an explicit request or opt-in test option.
- Preserve original documents and existing outputs. Use synthetic fixtures for tests; never commit personal documents, Hancom engines, or security DLLs.
- Do not register MCP, change global Codex configuration, edit the registry, approve popups, or terminate unrelated Hancom sessions automatically.
- Hancom Automation is an external Windows application, not a security sandbox. Use trusted documents only.
- Native content checks do not certify visual fidelity; report unverified layout honestly.
