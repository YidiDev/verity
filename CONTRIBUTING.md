# Contributing to Verity v1

Thanks for your interest in improving Verity! This document outlines the process for reporting
issues, proposing features, and submitting pull requests.

## Code of Conduct

Be respectful, curious, and supportive. Assume good intent and keep collaboration focused on
building trustworthy software. Harassment, discrimination, and dismissive behaviour are not
welcome.

## How to Contribute

1. **Open an issue first** for bugs, feature requests, or documentation updates. Provide
   concrete reproduction steps and describe the desired outcome.
2. **Discuss major changes** before investing significant effort. We optimise for a clear mental
   model and will suggest approaches that keep Verity's philosophy intact.
3. **Write tests and docs** alongside code. Every feature should include coverage and appear in the
   MkDocs guides or reference sections.
4. **Keep commits focused.** Prefer small, well-explained commits over large batches of work.
5. **Follow the style guide.** Python uses `ruff` + `black` defaults, JavaScript follows the
   existing conventions in `verity/shared/static/lib/core.js`, and Markdown sticks to
   80-character wrapping where practical.

## Pull Request Checklist

- [ ] Include a summary of the change and why it is needed.
- [ ] Add or update tests (where applicable).
- [ ] Update documentation, including `docs/` and examples.
- [ ] Run `pytest` (if tests exist) and `mkdocs build` locally.
- [ ] Ensure `npm run lint` or equivalent passes for frontend updates.

## Local Development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Optional: install JS tooling for adapter development
npm install --global @biomejs/biome
```

To work on the documentation:

```bash
mkdocs serve
```

Open <http://127.0.0.1:8000> to see live previews.

## Releasing Docs to GitHub Pages

The included GitHub Action (`.github/workflows/docs.yml`) builds and deploys the MkDocs site.
Ensure the `GH_TOKEN` secret has permission to push to the `gh-pages` branch before enabling the
workflow.

## Need Help?

File an issue or start a discussion thread. Maintainers will respond as soon as possible.
