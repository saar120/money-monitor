// Match the merchant grouping used by the mobile overview.
export function normalizeMerchant(description: string): string {
  const normalized = description
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d{2}\/\d{2}(?:\/\d{2,4})?/g, '')
    .replace(/\s*#?\d{5,}$/g, '')
    .trim();
  return (normalized || 'Transaction')
    .replace(/\d(?:[ -]*\d){11,}/g, (value) => ` •••• ${value.replace(/\D/g, '').slice(-4)} `)
    .trim();
}
