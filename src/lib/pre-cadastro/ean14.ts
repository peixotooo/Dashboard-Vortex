/**
 * EAN-14 (GTIN-14) Generator.
 *
 * Structure: [indicator "1"][12 random digits][check digit]
 * Matches the format used by existing Bulking products:
 *   10023602891620, 10028127463116, 10016299514828, etc.
 *
 * Check digit uses the GS1 mod-10 algorithm.
 */

function calculateCheckDigit(digits13: string): number {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = parseInt(digits13[i], 10);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Generates a valid EAN-14 code with random digits (no zeros padding).
 * Format matches existing Bulking EANs: 1XXXXXXXXXXXX + check digit.
 */
export function generateEAN14(): string {
  // Indicator "1" + 12 random digits
  let body = "";
  for (let i = 0; i < 12; i++) {
    body += Math.floor(Math.random() * 10).toString();
  }
  // Ensure first random digit is not 0 (avoids leading zeros after indicator)
  if (body[0] === "0") {
    body = String(Math.floor(Math.random() * 9) + 1) + body.slice(1);
  }

  const first13 = "1" + body;
  const checkDigit = calculateCheckDigit(first13);
  return first13 + String(checkDigit);
}

/**
 * Validates an EAN-14 code (checks length and check digit).
 */
export function isValidEAN14(ean: string): boolean {
  if (!/^\d{14}$/.test(ean)) return false;
  const first13 = ean.slice(0, 13);
  const expectedCheck = calculateCheckDigit(first13);
  return parseInt(ean[13], 10) === expectedCheck;
}
