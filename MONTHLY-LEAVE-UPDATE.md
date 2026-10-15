# Monthly leave-credit update

- PL: 1.0 day credited on the 25th of each month.
- CL: 0.5 day credited on the 25th of each month.
- Monthly credits are idempotent via unique employee/type/month ledger references.
- Existing databases: rerun `database/schema.sql` before restarting the API.
- Super-admin policy screen now configures credit day, monthly credit amount, and optional balance cap.

Scheduler timezone is the server timezone. Set the server timezone appropriately if the credit should run at a particular local time.
