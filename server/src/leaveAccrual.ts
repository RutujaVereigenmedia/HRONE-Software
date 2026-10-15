import { pool } from './db';

/**
 * Monthly leave accrual:
 * - PL: 1 day on the 25th of each month
 * - CL: 0.5 day on the 25th of each month
 *
 * On startup, this backfills any missed monthly credits up to the current
 * date. The unique reference key prevents duplicate credits when the
 * scheduler and startup backfill run more than once.
 */
export async function accrueLeaves() {
  const todayResult = await pool.query(`SELECT CURRENT_DATE::text AS today`);
  const todayText = String(todayResult.rows[0].today);
  const today = new Date(`${todayText}T00:00:00Z`);
  const employees = await pool.query(
    `SELECT id, joining_date::text AS joining_date
     FROM employees WHERE employment_status='ACTIVE'`
  );
  const policies = await pool.query(
    `SELECT leave_type, credit_days, credit_day, max_balance
     FROM leave_policies WHERE is_active=true`
  );

  for (const employee of employees.rows) {
    const joiningDate = new Date(`${String(employee.joining_date).slice(0, 10)}T00:00:00Z`);
    for (const policy of policies.rows) {
      const creditDay = Number(policy.credit_day || 25);
      const creditAmount = Number(policy.credit_days);
      let year = joiningDate.getUTCFullYear();
      let month = joiningDate.getUTCMonth();

      while (year < today.getUTCFullYear() ||
        (year === today.getUTCFullYear() && month <= today.getUTCMonth())) {
        const creditDate = new Date(Date.UTC(year, month, creditDay));
        if (creditDate >= joiningDate && creditDate <= today) {
          const yearMonth = `${year}-${String(month + 1).padStart(2, '0')}`;
          const reference = `accrual:${employee.id}:${policy.leave_type}:${yearMonth}`;
          await pool.query(
            `INSERT INTO leave_ledger
               (employee_id, leave_type, transaction_type, amount, reference_key, note)
             VALUES ($1, $2, 'CREDIT', $3, $4, $5)
             ON CONFLICT (reference_key) DO NOTHING`,
            [
              employee.id,
              policy.leave_type,
              creditAmount,
              reference,
              `Monthly ${policy.leave_type} credit on day ${creditDay} (${yearMonth})`
            ]
          );
        }
        month += 1;
        if (month > 11) { month = 0; year += 1; }
      }

      if (policy.max_balance !== null && policy.max_balance !== undefined) {
        const balanceResult = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS balance
           FROM leave_ledger WHERE employee_id=$1 AND leave_type=$2`,
          [employee.id, policy.leave_type]
        );
        const excess = Number(balanceResult.rows[0].balance) - Number(policy.max_balance);
        if (excess > 0) {
          const ref = `cap-adjust:${employee.id}:${policy.leave_type}:${todayText}`;
          await pool.query(
            `INSERT INTO leave_ledger
               (employee_id, leave_type, transaction_type, amount, reference_key, note)
             VALUES ($1, $2, 'ADJUSTMENT', $3, $4, 'Balance capped by leave policy')
             ON CONFLICT (reference_key) DO NOTHING`,
            [employee.id, policy.leave_type, -excess, ref]
          );
        }
      }
    }
  }
}
