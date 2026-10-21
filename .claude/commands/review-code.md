---
description: Run the code-reviewer subagent on a diff, branch or set of files
argument-hint: "[base branch | paths] (default: uncommitted changes, else main...HEAD)"
---

Use the `code-reviewer` subagent to review: $ARGUMENTS
If nothing is given, review uncommitted changes (`git diff`), or `git diff main...HEAD` if
the tree is clean. Return the verdict and findings unchanged.
