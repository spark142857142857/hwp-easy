# Project instructions

## Personal skills

- Personal skills are explicit-only. Preserve `policy.allow_implicit_invocation: false` in `agents/openai.yaml`.
- Skill explanation, editing, and installation requests do not authorize document operations.
- Do not carry a skill invocation into a separate later task.

## Commits

- Use Conventional Commit-style subjects: `feat:`, `fix:`, `docs:`, `test:`, `build:`, `chore:`.
- Keep code, documentation, tests, and build changes in meaningful scoped commits.
- By the owner's current instruction, push verified changes directly to `main` without creating a PR unless the user requests one. This applies to both Cloud and local sessions.
- Fetch `origin/main` before starting changes and again before pushing. Preserve concurrent work; report divergence or conflicts instead of force-pushing or resetting.
- A source push does not authorize production Sites deployment. Deploy only when requested.

## Product and safety

- Read `docs/PRD.md` before product changes. Distinguish user requirements, draft proposals, and current implementation; update the PRD when an approved pivot changes scope.
- The product goal is agent-first HWP editing without an installed Hancom application, including Linux/cloud execution. The native WASM path is a narrow first implementation; the preserved Windows COM prototype is not the default. Distinguish actual Linux HWP tests from mocks, hosted deployment, and visual fidelity certification.
- File access should be configurable within the permissions granted by the user and execution environment, not permanently restricted to one workspace by product policy. Preserve source/output protections and cloud user isolation separately; this does not change the current implementation or grant new host permissions.
- HWPX/PDF/DOCX conversion and export are outside the new product scope, not optional roadmap features. Existing COM export code is a legacy prototype capability; preserve it unless removal is requested.
- HWP Easy targets non-developers. Keep Python/pip/CLI setup in developer documentation, not as the promised normal user experience.
- Distinguish implemented capabilities from planned installer, GUI, and plugin distribution.
- Default to HWP-only. In the legacy COM prototype, generate PDF/DOCX only on an explicit request or opt-in test option; this does not add export to the new product scope.
- Default requested edits to verified, recoverable, conflict-checked same-file saving; use Save As only when requested. Do not interpret a save request as permission to overwrite unrelated files. Keep the legacy COM prototype's new-output-only behavior separate from the native storage path.
- Prevent unintended data loss and preserve previous versions for authorized replacement. Use synthetic fixtures for tests; never commit personal documents, Hancom engines, or security DLLs.
- Use ignored `testdocs/` for local user-supplied HWP checks. Default to read-only inspection; never upload these files, print document content, or overwrite originals as part of testing. Synthetic fixtures remain separate and reproducible in CI.
- Do not register MCP, change global Codex configuration, edit the registry, approve popups, or terminate unrelated Hancom sessions automatically.
- Hancom Automation is an external Windows application, not a security sandbox. Use trusted documents only.
- Native content checks do not certify visual fidelity; report unverified layout honestly.
