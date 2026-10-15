# Employee portal and payroll update

- Employee profile and contact information.
- Monthly payslip table with printable PDF format and earnings/deduction breakdown.
- Payroll components managed by Admin/Super Admin. Payslips are generated on the 4th, payment date set to the 5th.
- In-app notifications on payslip generation and company news/announcements. Optional SMS gateway integration through environment variables.
- Holiday calendar marks approved leave orange and company holidays green.
- HR handbook and monthly attendance Excel export.
- PostgreSQL schema additions are in `database/schema.sql`; migration for existing databases is `database/migrations/002_employee_portal.sql`.
