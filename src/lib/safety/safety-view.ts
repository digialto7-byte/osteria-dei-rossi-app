// M25b: who sees the Sicurezza placeholder (the future HACCP register, M31). No data sits behind the page, so this gate only decides
// whether the link and the page text show; the page reads nothing.
export const canSeeSafety = (role: string): boolean => role === "owner" || role === "admin";
