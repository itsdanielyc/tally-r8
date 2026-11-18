// The one currency the ledger is kept in. Amounts are stored as minor units,
// so switching to a currency with a different number of minor digits would
// silently change every amount's value (1234 is 12.34 USD but 1,234 JPY).
// That switch is allowed only while there are no transactions.
import type { Result } from "../contracts/tally";
import type { Ledger } from "./ledger";
import { findCurrency } from "./money";

export function setCurrency(ledger: Ledger, code: unknown): Result<Ledger> {
  const next = typeof code === "string" ? findCurrency(code) : undefined;
  if (!next) return { ok: false, error: { code: "invalid", field: "currency", message: "Tally does not know that currency." } };
  const current = findCurrency(ledger.settings.currency);
  if (ledger.transactions.length > 0 && current && current.digits !== next.digits) {
    return {
      ok: false,
      error: {
        code: "invalid",
        field: "currency",
        message: `${next.code} has ${next.digits} decimal places and ${current.code} has ${current.digits}; ` +
          "the currency can change to one with a different number only while the ledger is empty.",
      },
    };
  }
  return { ok: true, value: { ...ledger, settings: { ...ledger.settings, currency: next.code } } };
}
