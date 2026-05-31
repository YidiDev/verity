# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.x     | Yes                |
| < 2.0   | No                 |

Only the latest major version receives security fixes. If you are using an older version, please upgrade before reporting.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report vulnerabilities through [GitHub Security Advisories](https://github.com/YidiDev/verity/security/advisories/new). This ensures the report stays private until a fix is available.

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- The version(s) of Verity affected
- Any suggested fix, if you have one

### What to expect

- **Acknowledgment** within 48 hours of your report
- **Status update** within 7 days with an initial assessment
- **Target resolution** within 90 days for confirmed vulnerabilities, depending on severity and complexity
- A public disclosure and advisory once a fix is released

### Credit

If you report a valid vulnerability, you will be credited in the release notes and security advisory (unless you prefer to remain anonymous).

## Scope

Verity is a **client-side data layer library**. It does not run on servers or handle authentication directly. However, the following are in scope:

- **Cross-site scripting (XSS)** via unsanitized data flowing through directives or adapters
- **Prototype pollution** or injection through configuration or data processing
- **Dependency vulnerabilities** in Verity's direct dependencies that affect consumers
- **Information leakage** through devtools, error messages, or logging in production builds

The following are **out of scope**:

- Vulnerabilities in your own server or application code
- Issues in frameworks Verity integrates with (Alpine, React, Vue, Svelte) unless caused by Verity's adapter
- Denial of service against client-side code (this is inherent to any client-side library)
- Social engineering or phishing attacks

## Security Best Practices for Users

- Always use the latest version of Verity
- Sanitize data on your server before sending it to the client
- Do not expose sensitive data through Verity's devtools in production
- Review Verity's directives and ensure your server-sent instructions are authenticated
