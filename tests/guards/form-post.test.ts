import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Security fix: a `<form onSubmit>` with no method is a GET form. A tap before React hydrates submits it natively,
// and the browser puts every named field in the URL (`/login?email=...&password=...`): browser history, server and
// proxy logs. With `method="post"` the same early tap sends the values in the request body instead.
//
// The rule, kept simple on purpose: every `<form` in any .tsx file under src/ must carry `method="post"`. The named
// fields often live in a child component in another file (a form in one file, `<CoversField>` rendering `name="covers"`
// in another), so a same-file check misses them. The attribute is harmless on a form whose onSubmit calls
// `event.preventDefault()` first, which keeps a hydrated submit client-side. Forms that take a secret also keep their
// buttons disabled until hydrated (`useHydrated`).
const SRC = join(__dirname, "../../src");

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });

/** Drops block comments and whole-line `//` comments, so prose such as "it is not a <form>" is not a form. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The opening tag of every `<form`, up to its closing `>` (a `>` inside `{...}`, such as `=>`, does not count). */
function formTags(source: string): string[] {
  const tags: string[] = [];
  for (const match of source.matchAll(/<form(?=[\s>])/g)) {
    let depth = 0;
    let end = match.index;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

const isPost = (tag: string) => /\smethod=["']post["']/.test(tag);

/** The opening tags in `source` that would send their fields in a URL on a native submit. */
export function formsWithoutPost(source: string): string[] {
  const code = withoutComments(source);
  return formTags(code).filter((tag) => !isPost(tag));
}

describe("forms never submit by GET", () => {
  it('every form under src/ has method="post"', () => {
    const offenders = files(SRC).flatMap((file) =>
      formsWithoutPost(readFileSync(file, "utf8")).map(
        (tag) => `${file.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("finds the forms it should check (the scan is not empty)", () => {
    const withForms = files(SRC).filter((file) => formTags(readFileSync(file, "utf8")).length > 0);
    expect(withForms.length).toBeGreaterThan(30);
  });
});

describe("the guard itself", () => {
  const input = `<input name="password" />`;

  it("catches a form with no method", () => {
    expect(formsWithoutPost(`<form onSubmit={go}>${input}</form>`)).toHaveLength(1);
  });

  it('catches a form with method="get"', () => {
    expect(formsWithoutPost(`<form method="get" onSubmit={go}>${input}</form>`)).toHaveLength(1);
  });

  it('passes a form with method="post", on one line or several', () => {
    expect(formsWithoutPost(`<form method="post" onSubmit={go}>${input}</form>`)).toEqual([]);
    expect(formsWithoutPost(`<form\n  onSubmit={go}\n  method="post"\n>${input}</form>`)).toEqual(
      [],
    );
  });

  it("reads the whole tag when onSubmit holds an arrow function", () => {
    const tag = `<form onSubmit={(event) => { event.preventDefault(); }} className="x">`;
    expect(formsWithoutPost(`${tag}${input}</form>`)).toEqual([tag]);
    const post = `<form onSubmit={(event) => { go(); }} method="post">`;
    expect(formsWithoutPost(`${post}${input}</form>`)).toEqual([]);
  });

  it("catches a form whose named fields come from a child component in another file", () => {
    expect(formsWithoutPost(`<form onSubmit={go}><CoversField /></form>`)).toHaveLength(1);
  });

  it("does not count a <form> in a comment, or a component whose name starts with Form", () => {
    expect(formsWithoutPost(`// not a <form>\n/* <form> */\n${input}<FormRow />`)).toEqual([]);
  });
});
