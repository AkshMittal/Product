# gpx-audit

GPX audit toolkit for diagnosing track quality issues at scale.

It provides:
- A deterministic audit pipeline (`ingestion`, `temporal`, `sampling`, `motion`)
- Schema-based audit JSON outputs (`.audit.v2.json`)
- A single-file GPX workbench for interactive local inspection

## Branch context (`main`)

This README describes the `main` foundation branch, which contains:
- Pipeline modules under `js/pipeline/`
- Core project and pipeline docs under `docs/project/`
- Validation/report notes under `docs/reports/`
- Validation fixtures under `fixtures/adversarial-custom-test/`

For branch ownership and promotion rules, see [`BRANCH_POLICY.md`](BRANCH_POLICY.md).

## Start here

- Documentation hub: [`docs/README.md`](docs/README.md)
- Project docs index: [`docs/project/README.md`](docs/project/README.md)
- Pipeline technical writeup: [`docs/project/pipeline/post-1-pipeline-technical-writeup.md`](docs/project/pipeline/post-1-pipeline-technical-writeup.md)
- JSON glossary: [`docs/project/pipeline/json-schema-v2-glossary.md`](docs/project/pipeline/json-schema-v2-glossary.md)
- Adversarial status note: [`docs/reports/adversarial-validation-status.md`](docs/reports/adversarial-validation-status.md)

## Frontends

- Single-file GPX workbench (main deployment): [`https://gpx-audit.vercel.app/`](https://gpx-audit.vercel.app/)
- Case-study explorer (separate branch deployment): [`https://gpx-audit-case-study.vercel.app/`](https://gpx-audit-case-study.vercel.app/)

## Security

- Credential handling and commit safety: [`SECURITY.md`](SECURITY.md)

## License

- **ISC** license: [`LICENSE`](LICENSE) (also declared in [`package.json`](package.json)).
