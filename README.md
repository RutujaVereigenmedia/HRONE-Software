# HR One-style HRMS (React + Node.js + TypeScript + PostgreSQL)

A runnable HRMS starter with role-based authentication, employee directory, reporting hierarchy, leave balances/applications/approvals, attendance check-in/out, Excel import/export, audit events, and scheduled PL/CL accrual.

## Stack
- Frontend: React, Vite, TypeScript, React Router, plain CSS
- API: Node.js, Express, TypeScript, JWT, bcrypt
- Database: PostgreSQL
- Excel: `xlsx`
- Scheduled leave credits: `node-cron`

## Important policy defaults
- PL: 1 day on the 25th of each month
- CL: 0.5 day on the 25th of each month
- Accrual is calculated from `joining_date`, credited monthly on the 25th, and protected against duplicate credits by a unique ledger key.
- These are configurable business defaults, not legal advice. Have HR confirm eligibility, caps, carry-forward, rounding, probation and exit rules for your jurisdiction before production use.

## Requirements
Node.js 20+, PostgreSQL 14+, npm.

## Quick start
1. Create a PostgreSQL database:
   ```sql
   CREATE DATABASE hrms_db;
   ```
2. Apply the schema:
   ```bash
   psql -U postgres -d hrms_db -f database/schema.sql
   ```
3. Configure API:
   ```bash
   cd server
   cp .env.example .env
   # Set DATABASE_URL and JWT_SECRET
   npm install
   npm run seed
   npm run dev
   ```
4. Configure frontend in a second terminal:
   ```bash
   cd client
   npm install
   npm run dev
   ```
5. Open the Vite URL shown in terminal (usually http://localhost:5173).

## Demo accounts
Seed script creates:
- Super admin: `superadmin@demo.local` / `ChangeMe123!`
- Admin: `admin@demo.local` / `ChangeMe123!`
- Employee: `employee@demo.local` / `ChangeMe123!`

The seed command intentionally resets these demo accounts to the documented password every time it runs, so it also fixes stale demo password hashes. Change all demo passwords immediately and do not expose seeded credentials in production. If login says invalid credentials, stop the API, verify `server/.env` points to the same `hrms_db` where you ran `database/schema.sql`, then run `npm run seed` again from `server`.

## Excel employee import
Use the provided `templates/employee-import-template.csv` (Excel can open it and save as `.xlsx`) with columns:
`employee_code,first_name,last_name,email,phone,department,designation,joining_date,manager_email,role`
Upload it from Admin > Employees. `role` may be `EMPLOYEE` or `ADMIN`; super-admin assignment is intentionally not allowed through bulk import. Existing employee codes/emails are rejected rather than silently overwritten.

## Included modules
- Login/JWT and role checks
- Employee directory and reporting hierarchy
- PL/CL leave ledger and scheduled accrual
- Leave request and manager/admin approval flow
- Attendance check-in/check-out
- Employee import and employee export
- Dashboard summaries and audit events
- SQL schema, demo seed, setup guide and environment examples

## Troubleshooting login
- Confirm PostgreSQL is running and `DATABASE_URL` in `server/.env` points to the correct database.
- Run the schema once using `psql -U postgres -d hrms_db -f database/schema.sql`.
- In `server`, run `npm install`, then `npm run seed`; this resets demo passwords.
- Set `JWT_SECRET` to a random string at least 32 characters long.
- Start the API with `npm run dev`, then start the client in another terminal.
- Client API defaults to `http://localhost:4000/api`; override with `client/.env` based on `.env.example` if needed.

## Production hardening still required
Before public deployment add HTTPS/reverse proxy, secure secret management, rate limiting, CSRF strategy if using cookies, email delivery, password reset/MFA, backups/restore drills, retention rules, approval delegation, complete payroll/tax compliance, and tests/monitoring. Payroll, recruitment, assets, helpdesk, performance, expenses and integrations are represented as extension points rather than falsely claimed to be complete enterprise modules.


## Employee self-service and payroll update

The employee portal includes personal profile editing, payslip history, print-to-PDF salary slip, holiday calendar (approved leave highlighted orange), HR handbook, in-app notifications/news, and monthly attendance Excel export. Admin and super-admin accounts have a payroll setup screen to maintain salary components and generate payslips manually for a selected month.

### Payroll rules

- Payslips are scheduled to generate at 08:00 Asia/Kolkata time on the 4th of every month by default (`TZ` can override this).
- Payment date is set to the 5th of the same month.
- Earnings: basic salary, travel allowance, HRA, food allowance, and other allowance.
- Deductions: tax/TDS, PF, and other deductions; net pay is gross pay less deductions.
- Each employee/month can have only one payslip. Re-running generation does not duplicate it.
- Default salary components for employees without a salary structure are basic ₹30,000, travel ₹1,500, HRA ₹9,000, food ₹1,500, other ₹1,000, and deductions ₹0. HR should replace these illustrative defaults before real payroll use.
- Employees can open a payslip and choose **Print / Save PDF**. This creates a PDF using the browser print dialog.

### SMS notification setup

An in-app notification is created when a new payslip is generated. SMS is sent only if a compatible SMS gateway is configured in `server/.env` with `SMS_API_URL` and `SMS_API_TOKEN`; the gateway must accept a POST request with JSON `{ "to": "mobile-number", "message": "text" }` and Bearer-token authentication. Add the provider's endpoint/token yourself; do not put secrets in source control. Without this setup, the app cannot send actual SMS messages.

### Database

This project uses **PostgreSQL SQL**, not Oracle PL/SQL. Import `database/schema.sql` for a fresh database. For an existing installation, run `database/migrations/002_employee_portal.sql` after the original schema (the monthly leave policy schema can also be reapplied). Back up the database first.

### Important production checklist

The bundled holiday list is a starter sample and must be reviewed by HR. Tax/PF calculations are editable amounts, not a statutory payroll engine. Before production, configure real salary structures, verify tax and statutory deductions with a payroll professional, configure an SMS provider, use HTTPS, rotate JWT/demo secrets, and test backups/access permissions.
