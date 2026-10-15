-- Run after the original schema.sql when upgrading an existing database.
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
