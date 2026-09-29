import type { Database } from "./db.js";
import { AppError } from "./store.js";
export class Budget {
  constructor(
    private db: Database,
    private limitMicros: number,
  ) {}
  async reserve(micros: number) {
    const result = await this.db.query(
      "UPDATE model_budget SET reserved_micros=reserved_micros+$1 WHERE id=1 AND spent_micros+reserved_micros+$1<=$2 RETURNING id",
      [micros, this.limitMicros],
    );
    if (!result.rows.length)
      throw new AppError(
        503,
        "BUDGET_EXHAUSTED",
        "The demo’s AI allowance is exhausted. You can still browse books and use your basket.",
      );
  }
  async settle(reservation: number, actual: number) {
    await this.db.query(
      "UPDATE model_budget SET reserved_micros=reserved_micros-$1,spent_micros=spent_micros+$2 WHERE id=1",
      [reservation, Math.ceil(actual)],
    );
  }
  async snapshot() {
    const row = (
      await this.db.query<{ spent_micros: string; reserved_micros: string }>(
        "SELECT spent_micros,reserved_micros FROM model_budget WHERE id=1",
      )
    ).rows[0];
    return {
      spentMicros: Number(row.spent_micros),
      reservedMicros: Number(row.reserved_micros),
      limitMicros: this.limitMicros,
    };
  }
}
