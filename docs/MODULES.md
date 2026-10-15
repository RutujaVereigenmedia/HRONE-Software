# Module map and extension roadmap

## Implemented in this package
1. Authentication and authorization: JWT bearer token; `SUPER_ADMIN`, `ADMIN`, `EMPLOYEE`.
2. Employee directory: employee profile, department, designation, manager, joining date, employment status.
3. Organization hierarchy: manager-to-report relationships.
4. Leave: PL/CL policy intervals, idempotent automated accrual, balance ledger, employee request, admin decision and debit.
5. Attendance: check in/out and attendance history.
6. Excel: employee import from `.xlsx`, `.xls`, `.csv`; export to `.xlsx`.
7. Audit: create/import, attendance, leave requests and decisions.
8. Dashboards: organization summary for staff; own balances and activity for employees.

## Extension points, not yet full implementations
The screenshot contains a wider commercial HR suite. Payroll, recruitment/ATS, asset assignment, helpdesk, performance reviews, expense claims, engagement, mobile app and third-party marketplace integrations need their own business rules, schemas, screens, tests and external credentials. They are not represented as complete working modules in this starter. Build them incrementally rather than treating placeholder screens as production functionality.

## Suggested implementation order
- Departments and locations management, employee edit/deactivate, document storage and employee self-service profile editing
- Public holidays, work schedules, attendance corrections, shift and overtime rules
- Leave calendars, weekends/holiday calculation, approval chain per department, cancellation and partial-day leave
- Payroll components, statutory calculations, payslips and accounting exports after jurisdiction-specific review
- Recruitment pipeline, interview scheduling, offers and onboarding checklist
- Asset issue/return and helpdesk ticket workflow
- Performance cycles, goals, feedback and appraisal approvals
- Notifications/email, password reset, MFA, reporting, analytics and test automation
