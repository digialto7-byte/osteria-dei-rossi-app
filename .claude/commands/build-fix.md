---
description: Fix a failing build, type check, lint, test run or CI job with the smallest correct diff
argument-hint: <failing command or CI job> [error output]
---

Use the `build-error-resolver` subagent for: $ARGUMENTS
If no command is given, find the project's build, type-check, lint and test commands and run
them to find the first failure.
