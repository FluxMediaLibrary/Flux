# Security Policy

## Supported Versions

Flux is early-stage software. Security fixes are handled on the current default branch unless a maintainer states otherwise.

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

Use GitHub's private vulnerability reporting for this repository when available:

https://github.com/IDKDeadXD/Flux/security/advisories/new

If private vulnerability reporting is unavailable, contact the repository owner privately and include:

- A clear description of the issue.
- Steps to reproduce.
- Affected routes, clients, or deployment configuration.
- Impact and any known workaround.

Do not include real user passwords, JWT secrets, private media, production database dumps, keystores, or API keys.

## Scope

Security reports may include authentication bypasses, authorization issues, secret exposure, unsafe file access, remote code execution, SSRF, dependency vulnerabilities with a working exploit path, or deployment defaults that expose private services.

Out of scope: denial-of-service from unrealistic local resource exhaustion, reports without a reproducible path, and issues caused only by publishing your own secrets or media publicly.
