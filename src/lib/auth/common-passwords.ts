// Common passwords refused by checkNewPassword (M25a step 4, ADR-029 decision 3).
// Source:  https://github.com/danielmiessler/SecLists/blob/43cbd03be467262ca199816e4d2650c42759fa80/Passwords/Common-Credentials/10k-most-common.txt
// Commit:  43cbd03be467262ca199816e4d2650c42759fa80 (danielmiessler/SecLists)
// Licence: MIT, Copyright (c) 2018 Daniel Miessler (LICENSE of the same commit, read when this file was made).
// Only the entries of 10 or more characters are kept (shorter ones fail the length rule anyway), lower-cased,
// sorted and de-duplicated. Regenerate from the same file; do not edit by hand.

const WORDS = [
  "1234567890",
  "1q2w3e4r5t",
  "absolutely",
  "basketball",
  "businessbabe",
  "california",
  "charlie123",
  "cheerleaers",
  "christopher",
  "cocksucker",
  "contortionist",
  "deepthroat",
  "dragonball",
  "ejaculation",
  "enterprise",
  "experience",
  "experienced",
  "films+pic+galeries",
  "fuck_inside",
  "fuckinside",
  "gangbanged",
  "highlander",
  "housewifes",
  "insertions",
  "interacial",
  "intercourse",
  "knickerless",
  "lockerroom",
  "manchester",
  "masterbaiting",
  "masterbate",
  "masterbating",
  "masturbation",
  "motherfucker",
  "penetrating",
  "penetration",
  "peternorth",
  "playstation",
  "pornographic",
  "postov1000",
  "primetime21",
  "quant4307s",
  "qwertyuiop",
  "scandinavian",
  "techniques",
  "transexual",
  "unbelievable",
  "uncencored",
  "undertaker",
  "university",
  "washington",
] as const;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set<string>(WORDS);
/** The list in its stored (sorted) order, for the list's own tests. */
export const COMMON_PASSWORD_LIST: readonly string[] = WORDS;
