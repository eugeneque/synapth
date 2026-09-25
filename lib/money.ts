/** Display helpers for plan prices (RUB minor units) and wallet amounts (USD). */

export function formatMinor(amount: number, currency: "RUB" | "USD", locale: string): string {
  const major = amount / 100;
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Number.isInteger(major) ? 0 : 2, minimumFractionDigits: Number.isInteger(major) ? 0 : 2 }).format(major);
}

export function formatUsd(usd: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: usd < 1 ? 4 : 2 }).format(usd);
}
