# Contributing to Verity

> Building trustworthy data layers together

Thanks for your interest in improving Verity! This document outlines how to contribute in ways that align with Verity's philosophy and technical goals.

---

## Code of Conduct

**Be respectful, curious, and supportive.** Assume good intent and keep collaboration focused on building trustworthy software. Harassment, discrimination, and dismissive behavior are not welcome.

**We optimize for clarity over cleverness.** Code should be obvious, documentation should lead with "why," and features should solve real problems without introducing unnecessary complexity.

---

## Verity's Philosophy

Before contributing, please understand **what Verity is** and **what it isn't**:

### Core Principles

**✅ Verity IS:**
- A data layer that enforces truth-state vs view-state separation
- Server-truth only (no optimistic updates)
- Directive-driven (server authors invalidation)
- Honest by design (show spinners, not lies)
- Protocol and framework agnostic
- The "backend of the frontend"

**❌ Verity IS NOT:**
- A replacement for view layer state (Alpine, React, Vue, etc.)
- An optimistic update system
- A GraphQL client (though it can use GraphQL)
- A DOM manipulation library
- A backend framework

### Design Goals

When evaluating contributions, we ask:

1. **Does it preserve truth-state authority?** Changes that blur server/client boundaries won't be accepted.
2. **Does it maintain honesty?** Features that encourage "lying to users" (optimistic updates, fake loading states) won't be accepted.
3. **Does it simplify the mental model?** Complexity must pay for itself in real-world value.
4. **Is it framework-agnostic?** Core features should work with any UI framework.

**See:** [Philosophy](https://verity.yidi.sh/philosophy/) | [Architecture](https://verity.yidi.sh/architecture/)

---

## How to Contribute

### 1. Start with an Issue

**Before writing code:**

1. **Search existing issues** to avoid duplicates
2. **Open a new issue** describing:
   - The problem you're solving
   - Why it aligns with Verity's philosophy
   - Proposed approach (for features)
   - Reproduction steps (for bugs)

**For major changes:** Start a Discussion thread to validate the approach before investing time.

### 2. Discuss Philosophy Alignment

**Questions to consider:**

- Does this feature respect server truth?
- Does it maintain the truth/view boundary?
- Could this be solved in the view layer instead?
- Does it add essential complexity or incidental complexity?

**We may suggest alternative approaches** that better align with Verity's goals.

### 3. Write Code

**Follow these guidelines:**

#### Code Quality

- **Clear over clever:** Prioritize readability
- **Small commits:** Each commit should be a logical unit
- **Meaningful names:** Variables and functions should be self-documenting
- **Comment the "why":** Code shows "what," comments explain "why"

#### Testing

- Add tests for new features
- Update tests for changes
- Include edge cases
- Test across frameworks (if relevant)

#### Documentation

**Every contribution needs documentation:**

- **API changes:** Update `docs/reference/`
- **New features:** Add to `docs/guides/`
- **Conceptual changes:** Update `docs/concepts/`
- **Examples:** Add or update `verity/examples/`

**Documentation should:**
- Lead with WHY, not WHAT
- Include code examples
- Show Material for MkDocs features (admonitions, tabs, diagrams)
- Cross-reference related docs

---

## Pull Request Checklist

Before submitting:

- [ ] **Issue exists** and is referenced in PR description
- [ ] **Philosophy alignment** explained (for features)
- [ ] **Tests added** (or explanation why not needed)
- [ ] **Documentation updated** in `docs/`
- [ ] **Examples updated** if behavior changed
- [ ] **Code formatted** (Python: `ruff` + `black`, JS: existing style)
- [ ] **Commits are focused** (one logical change per commit)
- [ ] **Local build passes** (`mkdocs build`, tests, etc.)

### PR Template

```markdown
## Summary
Brief description of what this changes and why.

## Philosophy Alignment
How does this align with Verity's principles? 
(Required for features, optional for bug fixes)

## Changes
- Bullet list of changes
- Include files modified

## Testing
How was this tested? What edge cases were considered?

## Documentation
What documentation was added or updated?

## Breaking Changes
Are there any breaking changes? Migration guide?

Closes #123
```

---

## Contribution Types

### 🐛 Bug Fixes

**What we need:**

1. **Reproduction steps** (ideally a minimal example)
2. **Expected behavior** vs actual behavior
3. **Fix** with explanation of root cause
4. **Test** that prevents regression

**Philosophy check:** Does the fix maintain server-truth? Or does it introduce optimistic patterns?

### ✨ Features

**What we need:**

1. **Use case** (real-world scenario, not hypothetical)
2. **Philosophy alignment** explanation
3. **API design** that fits existing patterns
4. **Complete implementation** (code + tests + docs)
5. **Example usage** in `verity/examples/`

**High-value features:**

- New framework adapters (Solid, Preact, etc.)
- Performance improvements (with benchmarks)
- Better devtools visibility
- Real-world example applications
- Migration guides from other libraries

**Features we'll reject:**

- Optimistic update APIs
- Client-side directive generation
- Features that blur truth/view boundaries
- Features that work around Verity's philosophy

### 📚 Documentation

**Always welcome!**

- Typo fixes
- Clarity improvements
- New guides and tutorials
- Better examples
- Architecture diagrams
- Comparison tables

**Documentation style:**

- Lead with WHY (problem/motivation)
- Use Material for MkDocs features
- Include mermaid diagrams for architecture
- Add admonitions for tips/warnings
- Use tabs for comparisons
- Cross-reference related docs

### 🎨 Examples

**New examples should:**

- Solve a **real-world domain** (not TODO apps)
- Include a **baseline version** without Verity
- Demonstrate **key Verity patterns**
- Have an **architecture diagram**
- Include a **comparison** section

**Example structure:**

```
your_example/
├── app.py                    # Flask backend
├── templates/
│   └── index.html
├── static/
│   └── app.js
├── README.md                 # Architecture + patterns
└── your_example_baseline/    # Version without Verity
```

---

## Local Development

### Setup

```bash
# Clone repository
git clone https://github.com/YidiDev/verity.git
cd verity

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Running Examples

```bash
# Run an example
python verity/examples/invoices_alpine/app.py

# Open http://localhost:5000
```

### Documentation

```bash
# Serve documentation locally
mkdocs serve

# Open http://127.0.0.1:8000

# Build documentation
mkdocs build
```

### Testing

```bash
# Run Python tests (if they exist)
pytest

# Run JS tests (if they exist)
npm test
```

### Code Formatting

**Python:**

```bash
# Format
black verity/

# Lint
ruff verity/
```

**JavaScript:**

```bash
# Follow existing style in verity/shared/static/lib/core.js
# Use Prettier or similar if preferred
```

---

## What Makes a Good Contribution?

### ✅ Good Contributions

**Example 1: Add Solid.js Adapter**

```markdown
## Summary
Adds Solid.js adapter following the same pattern as React/Vue adapters.

## Philosophy Alignment
Maintains truth/view separation. Solid components access truth-state 
via `useVerityCollection()`, manage view-state via `createSignal()`.

## Changes
- `verity/shared/adapters/solid.js` - New adapter
- `docs/reference/adapters.md` - Added Solid section
- `verity/examples/manufacturing_monitor_solid/` - Example app

## Testing
Tested with Solid 1.8+, verified same behavior as React adapter.
```

**Why it's good:**
- Real-world value (Solid is popular)
- Follows existing patterns
- Complete (code + docs + example)
- Philosophy-aligned

---

**Example 2: Improve Devtools SSE Panel**

```markdown
## Summary
Add sequence gap detection visualization to devtools SSE panel.

## Changes
- Shows missed sequences in red
- Displays resync triggers
- Adds timeline of connection state

## Testing
Tested by manually disconnecting SSE and observing gap detection.
```

**Why it's good:**
- Improves debugging
- Adds real value
- Non-breaking change
- Well-tested

---

### ❌ Bad Contributions

**Example 1: Add Optimistic Updates**

```markdown
## Summary
Adds `optimistic: true` option to mutations for instant UI updates.
```

**Why it's bad:**
- Violates core philosophy (server-truth only)
- Introduces temporary lies
- Would be rejected immediately

---

**Example 2: Add Client-Side Directive Generation**

```markdown
## Summary
Adds `autoDirectives: true` to automatically generate directives 
client-side after mutations.
```

**Why it's bad:**
- Server should author directives (domain knowledge)
- Moves invalidation logic to client
- Breaks server-authored contract

---

## Philosophy Deep Dives

### Truth-State vs View-State

**When reviewing contributions, we ask:**

- Is this **truth-state** (server-owned, multi-client)?
- Or **view-state** (client-owned, local)?

**Examples:**

| Data | Classification | Why |
|------|---------------|-----|
| Todo items | Truth-state | Server owns, other clients must see |
| Which menu is open | View-state | Local UI concern, doesn't need server |
| User permissions | Truth-state | Server decides, security-critical |
| Current tab | View-state | Local navigation state |

**Contributions that blur this line will be rejected.**

### Server-Truth Only

**We reject features that:**

- Show unconfirmed state as "real"
- Implement optimistic updates
- Allow client-side truth modification
- Fake loading states

**We accept features that:**

- Make server responses faster
- Improve spinner/skeleton UX
- Add directive payload optimization
- Reduce unnecessary fetches

### Directive-Driven Updates

**Server authors the invalidation contract.**

**We reject:**
- Client-side directive generation
- Automatic invalidation guessing
- Implicit refetch triggers

**We accept:**
- Better directive APIs
- New directive types (with justification)
- Directive optimization strategies

---

## Release Process

**Maintainers handle releases.** Contributors should:

1. Focus on features, not versioning
2. Document breaking changes clearly
3. Suggest version bump if relevant (major/minor/patch)

---

## Getting Help

**Resources:**

- 📖 [Documentation](https://verity.yidi.sh)
- 💬 [GitHub Discussions](https://github.com/YidiDev/verity/discussions)
- 🐛 [GitHub Issues](https://github.com/YidiDev/verity/issues)
- 📧 Email: yididev@gmail.com

**Before asking:**

1. Check the documentation
2. Search existing issues/discussions
3. Read the philosophy guide
4. Try reproducing with a minimal example

---

## Recognition

All contributors are credited in release notes and documentation. Significant contributions may be highlighted in the project README.

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License (same as Verity itself).

---

## Need More Context?

**Essential reading for contributors:**

1. [Philosophy](https://verity.yidi.sh/philosophy/) - Core beliefs and trade-offs
2. [Architecture](https://verity.yidi.sh/architecture/) - How the layers interact
3. [Truth vs View State](https://verity.yidi.sh/concepts/truth-vs-view-state/) - The key distinction
4. [Directives](https://verity.yidi.sh/concepts/directives/) - Server-authored contract
5. [Examples](https://verity.yidi.sh/examples/) - Patterns in practice

---

## Thank You! 🙏

Every contribution—no matter how small—helps make Verity better. Whether it's a typo fix, a new example, or a major feature, we appreciate your time and effort.

Let's build trustworthy data layers together!
