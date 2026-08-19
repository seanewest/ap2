export const BRANCHES: Readonly<{ A: string; B: string }>;

export function commandReceipt(branch: "A" | "B"): {
  branch: "A" | "B";
  command: string;
  sha256: string;
  encodedBytes?: number;
  validUtf16LeLength?: boolean;
  decodedUtf16Le?: string;
  decodedMatchesExpected?: boolean;
};
