# Monthly leave credit logic

The default leave policy is:
- **PL (Privilege Leave):** 1.0 day credited on the 25th of each month.
- **CL (Casual Leave):** 0.5 day credited on the 25th of each month.

The backend scheduler runs at 01:15 on the 25th of every month using the server's timezone. On API startup, the same accrual function backfills all eligible monthly credits through the current database date. An employee receives a month's credit only when their joining date is on or before that month's 25th. An employee who joins after the 25th starts receiving credits from the following month's 25th.

Each credit uses the deterministic ledger key `accrual:<employee-id>:<leave-type>:<YYYY-MM>`. The database unique constraint makes repeated runs idempotent, so startup backfills and the scheduler cannot create duplicate credits for the same employee, leave type and month.

Super admins can configure the credit day (1–28), credit amount and optional maximum balance. The allowed day range avoids invalid dates in shorter months. Existing historical ledger entries are not rewritten if the policy changes. Optional balance caps create an adjustment ledger entry.

Approved leave requests create a debit in the ledger. Rejected requests do not debit the balance.

Before production use, HR should confirm carry-forward, expiry, probation eligibility, notice-period rules, holiday/weekend treatment, half-day rules and applicable employment law. The request form currently accepts the number of leave days from the user and does not yet calculate working days from a holiday calendar.
