## Description

Brief description of the changes and motivation.

**Related issue:** #

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] CI/build/infrastructure change

## Checklist

- [ ] I have read the [Contributing Guide](../CONTRIBUTING.md)
- [ ] This change aligns with Verity's philosophy (server-truth, no optimistic updates, framework-agnostic)
- [ ] I have added or updated tests that cover the changes
- [ ] All existing tests pass (`yarn vitest run`)
- [ ] Typecheck passes (`yarn typecheck`)
- [ ] Lint passes (`yarn lint`)
- [ ] I have updated documentation if needed

## Security Considerations

- [ ] This change does not introduce XSS vectors or unsanitized data paths
- [ ] This change does not expose sensitive information in logs, errors, or devtools
- [ ] New dependencies (if any) have been reviewed for known vulnerabilities
- [ ] No secrets, tokens, or credentials are included in this PR
