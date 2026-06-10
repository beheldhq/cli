# Security Policy

Beheld stores developer profile data locally and signs the bundles it
produces. Defects in the CLI, MCP server, sanitizer, bundle format, or
installer can have privacy or integrity implications, so we treat reports
seriously.

## Supported versions

| Version | Receives fixes |
| --- | --- |
| 0.5.x (current) | Yes |
| < 0.5 | No (pre-release prototypes) |

Only the latest minor line receives fixes. When 0.6 ships, 0.5 will be
end-of-life within 60 days.

## Reporting a vulnerability

Email **security@beheld.dev** with a description and any reproduction
steps. If you'd like to encrypt the report, request our PGP key in plain
text first and we'll reply with the current fingerprint.

Please do not file public GitHub issues for suspected vulnerabilities.

## What's in scope for this repo

- The CLI binary and its commands
- The MCP server and its tools
- The bundle wire format (version 7) and its signing/verification
- The harness collectors and the sanitizer patterns
- The installer (`beheld init`, `beheld bootstrap`) and the autostart
  artifacts it writes (LaunchAgent plist, systemd unit)

Findings in any of the above should be reported here.

## What's out of scope for this repo

- The proprietary scoring engine. Report engine issues separately —
  contact security@beheld.dev and we'll route to the engine team.
- Issues in third-party dependencies. Please file upstream and let us know
  so we can coordinate a release.

## Response timeline

| Stage | Target |
| --- | --- |
| Acknowledge receipt | 2 working days |
| First triage and severity rating | 5 working days |
| Fix or workaround for high-severity findings | 30 days |
| Public disclosure | Up to 90 days, coordinated with the reporter |

If a finding is being actively exploited in the wild, we will accelerate
disclosure and publish mitigations as soon as a fix is available.

## Recognition

We do not run a paid bounty program. Reporters who follow this policy are
credited in the release notes for the version that contains the fix,
unless they prefer to remain anonymous.
