# Security Policy

## Supported scope

This repository is actively maintained for documentation, pipeline logic, and static frontend tooling. Security reports are welcome for:

- credential exposure risks
- unsafe handling of secrets/tokens
- dependency or supply-chain concerns
- frontend data handling issues that could leak sensitive values

## Reporting a vulnerability

Please report security issues privately:

- Open a GitHub security advisory if available, or
- Contact the maintainer directly before creating a public issue

Include:

- clear reproduction steps
- affected file(s) and branch
- potential impact
- suggested mitigation (if known)

## Secrets and credential hygiene

- Never commit service-role keys, private tokens, or `.env` files.
- Use `.env` locally and keep it out of version control.
- Treat Supabase keys with least-privilege discipline.
- Rotate keys immediately if accidental exposure is suspected.

## Disclosure expectations

- Please allow reasonable time for triage and remediation before public disclosure.
- Confirm fixes on the latest `main` branch unless a branch-specific issue is reported.
