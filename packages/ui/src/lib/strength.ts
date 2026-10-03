export interface Strength {
  /** 0 (empty) – 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint?: string;
  acceptable: boolean;
}

const COMMON = ["password", "123456", "qwerty", "letmein", "wallet", "crypto", "bitcoin", "111111", "iloveyou"];

/** Small, dependency-free estimator. The vault's Argon2id does the real work; this nudges users. */
export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "", acceptable: false };
  const lower = pw.toLowerCase();
  if (COMMON.some((c) => lower.includes(c)) && pw.length < 16) {
    return { score: 1, label: "Too common", hint: "Avoid well-known words and number runs.", acceptable: false };
  }
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/\d/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  const unique = new Set(pw).size;
  let bits = pw.length * Math.log2(Math.max(10, classes * 18));
  if (unique < pw.length / 2) bits *= 0.6;
  if (pw.length < 8) return { score: 1, label: "Too short", hint: "Use at least 8 characters.", acceptable: false };
  if (bits < 45) return { score: 2, label: "Okay", hint: "Longer is better — try a few unrelated words.", acceptable: true };
  if (bits < 70) return { score: 3, label: "Good", acceptable: true };
  return { score: 4, label: "Strong", acceptable: true };
}
