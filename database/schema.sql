CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('SUPER_ADMIN','ADMIN','EMPLOYEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE leave_type AS ENUM ('PL','CL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE leave_status AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  designation TEXT,
  manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  joining_date DATE NOT NULL DEFAULT CURRENT_DATE,
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (employment_status IN ('ACTIVE','INACTIVE','EXITED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'EMPLOYEE',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_policies (
  leave_type leave_type PRIMARY KEY,
  interval_days INTEGER NOT NULL DEFAULT 30 CHECK (interval_days > 0),
  credit_days NUMERIC(8,2) NOT NULL DEFAULT 1 CHECK (credit_days > 0),
  credit_day INTEGER NOT NULL DEFAULT 25 CHECK (credit_day BETWEEN 1 AND 28),
  max_balance NUMERIC(8,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
-- Safe for existing databases created from an earlier project version.
ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS credit_day INTEGER NOT NULL DEFAULT 25;
ALTER TABLE leave_policies DROP CONSTRAINT IF EXISTS leave_policies_credit_day_check;
ALTER TABLE leave_policies ADD CONSTRAINT leave_policies_credit_day_check CHECK (credit_day BETWEEN 1 AND 28);
INSERT INTO leave_policies(leave_type, interval_days, credit_days, credit_day)
VALUES ('PL',30,1,25),('CL',30,0.5,25)
ON CONFLICT (leave_type) DO UPDATE
SET interval_days=EXCLUDED.interval_days,
    credit_days=EXCLUDED.credit_days,
    credit_day=EXCLUDED.credit_day;

CREATE TABLE IF NOT EXISTS leave_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('CREDIT','DEBIT','ADJUSTMENT')),
  amount NUMERIC(8,2) NOT NULL CHECK (amount <> 0),
  reference_key TEXT UNIQUE,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_ledger_employee ON leave_ledger(employee_id, leave_type, created_at);

CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type leave_type NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC(8,2) NOT NULL CHECK (days > 0),
  reason TEXT NOT NULL,
  status leave_status NOT NULL DEFAULT 'PENDING',
  approver_id UUID REFERENCES users(id) ON DELETE SET NULL,
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW employee_leave_balances AS
SELECT e.id AS employee_id, lp.leave_type,
       COALESCE(SUM(CASE WHEN ll.transaction_type IN ('CREDIT','ADJUSTMENT') THEN ll.amount
                         WHEN ll.transaction_type='DEBIT' THEN ll.amount ELSE 0 END),0) AS balance
FROM employees e CROSS JOIN leave_policies lp
LEFT JOIN leave_ledger ll ON ll.employee_id=e.id AND ll.leave_type=lp.leave_type
GROUP BY e.id, lp.leave_type;


-- Employee portal, monthly payslips, holidays, announcements and notifications
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account_last4 TEXT;

CREATE TABLE IF NOT EXISTS salary_structures (
 employee_id UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
 basic_salary NUMERIC(12,2) NOT NULL DEFAULT 30000 CHECK (basic_salary >= 0),
 travel_allowance NUMERIC(12,2) NOT NULL DEFAULT 1500 CHECK (travel_allowance >= 0),
 hra NUMERIC(12,2) NOT NULL DEFAULT 9000 CHECK (hra >= 0),
 food_allowance NUMERIC(12,2) NOT NULL DEFAULT 1500 CHECK (food_allowance >= 0),
 other_allowance NUMERIC(12,2) NOT NULL DEFAULT 1000 CHECK (other_allowance >= 0),
 tax_deduction NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_deduction >= 0),
 pf_deduction NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pf_deduction >= 0),
 other_deduction NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other_deduction >= 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS salary_slips (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 pay_month DATE NOT NULL,
 basic_salary NUMERIC(12,2) NOT NULL,
 travel_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
 hra NUMERIC(12,2) NOT NULL DEFAULT 0,
 food_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
 other_allowance NUMERIC(12,2) NOT NULL DEFAULT 0,
 tax_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
 pf_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
 other_deduction NUMERIC(12,2) NOT NULL DEFAULT 0,
 gross_pay NUMERIC(12,2) NOT NULL,
 total_deductions NUMERIC(12,2) NOT NULL,
 net_pay NUMERIC(12,2) NOT NULL,
 generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 payment_date DATE NOT NULL,
 UNIQUE(employee_id,pay_month)
);
CREATE TABLE IF NOT EXISTS holidays (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 holiday_date DATE NOT NULL UNIQUE,
 name TEXT NOT NULL,
 description TEXT,
 is_optional BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS announcements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 audience TEXT NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL','EMPLOYEE','ADMIN')),
 published BOOLEAN NOT NULL DEFAULT TRUE,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 notification_type TEXT NOT NULL DEFAULT 'INFO',
 read_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id,created_at DESC);
CREATE TABLE IF NOT EXISTS handbook_documents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 title TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT 'General',
 body TEXT NOT NULL,
 published BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO holidays(holiday_date,name,description) VALUES
 ('2026-01-26','Republic Day','National holiday'),('2026-08-15','Independence Day','National holiday'),
 ('2026-10-02','Gandhi Jayanti','National holiday'),('2026-12-25','Christmas Day','National holiday')
ON CONFLICT(holiday_date) DO NOTHING;
INSERT INTO announcements(title,body,audience) VALUES
 ('Welcome to the employee portal','Use this workspace to check leave balances, attendance, payslips and HR updates.','ALL'),
 ('Payslip availability','Monthly payslips are scheduled to be generated on the 4th; salary payment date is the 5th.','EMPLOYEE')
ON CONFLICT DO NOTHING;
INSERT INTO handbook_documents(title,category,body) VALUES
 ('Leave policy','Leave','PL is credited at 1 day and CL at 0.5 day on the 25th of each month. Submit requests through Leave & balances and wait for manager/HR approval.'),
 ('Attendance policy','Attendance','Record your check-in and check-out every working day. Review monthly records in Attendance.'),
 ('Payroll and payslips','Payroll','Payslips are generated on the 4th for the upcoming 5th salary payment. Review earnings and deductions and contact HR for corrections.')
ON CONFLICT DO NOTHING;
