export function normalizeBrazilianWhatsAppPhone(
  raw: string | null | undefined
): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;

  // Already in Brazilian E.164 digits: 55 + DDD + number.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }

  // VNDA commonly sends DDD + number without the country code.
  // DDD 55 exists, so "559..." with 11 digits is still local BR and needs
  // another 55 prefix.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

export function requireBrazilianWhatsAppPhone(
  raw: string | null | undefined
): string {
  return normalizeBrazilianWhatsAppPhone(raw) || "";
}
