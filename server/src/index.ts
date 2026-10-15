import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import XLSX from 'xlsx';
import { z } from 'zod';
import { pool } from './db';
import { authenticate, allow, audit, AuthedRequest } from './auth';
import { accrueLeaves } from './leaveAccrual';
dotenv.config();
const app=express();
app.use(cors({origin:process.env.CLIENT_ORIGIN||'http://localhost:5173'}));
app.use(express.json({limit:'5mb'}));
const asyncRoute=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve(fn(req,res,next)).catch(next);

app.get('/api/health',asyncRoute(async(_req:any,res:any)=>{await pool.query('SELECT 1');res.json({status:'ok',database:'connected'});}));

app.post('/api/auth/login',asyncRoute(async(req:any,res:any)=>{
 const schema=z.object({email:z.string().email(),password:z.string().min(1)});
 const parsed=schema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Valid email and password are required'});
 const r=await pool.query('SELECT id,email,password_hash,role,employee_id,is_active FROM users WHERE lower(email)=lower($1)',[parsed.data.email]);
 const user=r.rows[0];
 if(!user||!user.is_active||!(await bcrypt.compare(parsed.data.password,user.password_hash))) {
   return res.status(401).json({error:'Invalid email or password. If this is a demo account, run `npm run seed` in the server folder to reset demo credentials.'});
 }
 const token=jwt.sign({sub:user.id},process.env.JWT_SECRET||'',{expiresIn:'8h'});
 const profile=user.employee_id?(await pool.query(`SELECT e.*,d.name AS department, m.first_name||' '||m.last_name AS manager_name
  FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.manager_id WHERE e.id=$1`,[user.employee_id])).rows[0]:null;
 res.json({token,user:{id:user.id,email:user.email,role:user.role,employee:profile}});
}));
app.get('/api/auth/me',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 const u=await pool.query('SELECT id,email,role,employee_id FROM users WHERE id=$1',[req.user!.id]);
 const employee=u.rows[0].employee_id?(await pool.query('SELECT * FROM employees WHERE id=$1',[u.rows[0].employee_id])).rows[0]:null;
 res.json({user:u.rows[0],employee});
}));

app.get('/api/dashboard',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 const isStaff=req.user!.role!=='EMPLOYEE';
 const empId=req.user!.employee_id;
 if(isStaff){
  const [employees, pending, today, departments]=await Promise.all([
   pool.query(`SELECT COUNT(*)::int AS count FROM employees WHERE employment_status='ACTIVE'`),
   pool.query(`SELECT COUNT(*)::int AS count FROM leave_requests WHERE status='PENDING'`),
   pool.query(`SELECT COUNT(*)::int AS count FROM attendance WHERE work_date=CURRENT_DATE AND check_in IS NOT NULL`),
   pool.query(`SELECT d.name,COUNT(e.id)::int AS count FROM departments d LEFT JOIN employees e ON e.department_id=d.id AND e.employment_status='ACTIVE' GROUP BY d.id ORDER BY d.name`)
  ]);
  res.json({scope:'organization',employees:employees.rows[0].count,pendingLeaves:pending.rows[0].count,checkedInToday:today.rows[0].count,departments:departments.rows});
 } else {
  const [balances,attendance,requests]=await Promise.all([
   pool.query(`SELECT leave_type,balance FROM employee_leave_balances WHERE employee_id=$1`,[empId]),
   pool.query(`SELECT * FROM attendance WHERE employee_id=$1 ORDER BY work_date DESC LIMIT 7`,[empId]),
   pool.query(`SELECT * FROM leave_requests WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 5`,[empId])
  ]);
  res.json({scope:'employee',balances:balances.rows,attendance:attendance.rows,requests:requests.rows});
 }
}));

app.get('/api/employees',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(_req:any,res:any)=>{
 const r=await pool.query(`SELECT e.id,e.employee_code,e.first_name,e.last_name,e.email,e.phone,e.designation,e.joining_date,e.employment_status,
 d.name AS department,m.first_name||' '||m.last_name AS manager_name,m.email AS manager_email,u.role
 FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.manager_id
 LEFT JOIN users u ON u.employee_id=e.id ORDER BY e.created_at DESC`);
 res.json(r.rows);
}));
app.post('/api/employees',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{
 const schema=z.object({employee_code:z.string().min(1),first_name:z.string().min(1),last_name:z.string().min(1),email:z.string().email(),phone:z.string().optional().nullable(),department:z.string().optional().nullable(),designation:z.string().optional().nullable(),joining_date:z.string().optional(),manager_email:z.string().email().optional().nullable(),role:z.enum(['EMPLOYEE','ADMIN']).default('EMPLOYEE'),password:z.string().min(8).default('Welcome123!')});
 const p=schema.safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.issues[0].message});
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  let departmentId=null;
  if(p.data.department){const d=await c.query(`INSERT INTO departments(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[p.data.department]);departmentId=d.rows[0].id;}
  let managerId=null;
  if(p.data.manager_email){const m=await c.query('SELECT id FROM employees WHERE email=$1',[p.data.manager_email]);if(!m.rows[0])throw new Error('Manager email not found');managerId=m.rows[0].id;}
  const e=await c.query(`INSERT INTO employees(employee_code,first_name,last_name,email,phone,department_id,designation,joining_date,manager_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[p.data.employee_code,p.data.first_name,p.data.last_name,p.data.email,p.data.phone||null,departmentId,p.data.designation||null,p.data.joining_date||new Date().toISOString().slice(0,10),managerId]);
  const hash=await bcrypt.hash(p.data.password,12);
  await c.query(`INSERT INTO users(employee_id,email,password_hash,role) VALUES($1,$2,$3,$4)`,[e.rows[0].id,p.data.email,hash,p.data.role]);
  await c.query('COMMIT');await audit(req.user!.id,'EMPLOYEE_CREATED','employee',e.rows[0].id,{email:p.data.email});
  res.status(201).json(e.rows[0]);
 }catch(err:any){await c.query('ROLLBACK');res.status(400).json({error:err.message||'Unable to create employee'});}finally{c.release();}
}));
app.get('/api/org/hierarchy',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(_req:any,res:any)=>{
 const r=await pool.query(`SELECT e.id,e.employee_code,e.first_name,e.last_name,e.email,e.designation,d.name AS department,
 m.id AS manager_id,m.first_name||' '||m.last_name AS manager_name
 FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.manager_id
 WHERE e.employment_status='ACTIVE' ORDER BY d.name,e.last_name`);
 res.json(r.rows);
}));

app.get('/api/leaves/balances',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 const all=req.user!.role!=='EMPLOYEE';
 const r=all?await pool.query(`SELECT e.employee_code,e.first_name,e.last_name,e.email,b.leave_type,b.balance FROM employee_leave_balances b JOIN employees e ON e.id=b.employee_id ORDER BY e.last_name,b.leave_type`)
 :await pool.query(`SELECT leave_type,balance FROM employee_leave_balances WHERE employee_id=$1`,[req.user!.employee_id]);
 res.json(r.rows);
}));
app.get('/api/leaves/requests',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 const staff=req.user!.role!=='EMPLOYEE';
 const r=staff?await pool.query(`SELECT l.*,e.employee_code,e.first_name,e.last_name,e.email FROM leave_requests l JOIN employees e ON e.id=l.employee_id ORDER BY l.created_at DESC`)
 :await pool.query(`SELECT * FROM leave_requests WHERE employee_id=$1 ORDER BY created_at DESC`,[req.user!.employee_id]);
 res.json(r.rows);
}));
app.post('/api/leaves/requests',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 if(!req.user!.employee_id)return res.status(400).json({error:'User is not linked to an employee'});
 const s=z.object({leave_type:z.enum(['PL','CL']),start_date:z.string(),end_date:z.string(),days:z.coerce.number().positive(),reason:z.string().min(3)});
 const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check leave request fields'});
 if(p.data.end_date<p.data.start_date)return res.status(400).json({error:'End date must be on or after start date'});
 const balance=await pool.query(`SELECT balance FROM employee_leave_balances WHERE employee_id=$1 AND leave_type=$2`,[req.user!.employee_id,p.data.leave_type]);
 if(Number(balance.rows[0]?.balance||0)<p.data.days)return res.status(400).json({error:'Insufficient leave balance'});
 const r=await pool.query(`INSERT INTO leave_requests(employee_id,leave_type,start_date,end_date,days,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
 [req.user!.employee_id,p.data.leave_type,p.data.start_date,p.data.end_date,p.data.days,p.data.reason]);
 await audit(req.user!.id,'LEAVE_REQUESTED','leave_request',r.rows[0].id,{});res.status(201).json(r.rows[0]);
}));
app.patch('/api/leaves/requests/:id/decision',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{
 const s=z.object({status:z.enum(['APPROVED','REJECTED']),decision_note:z.string().optional()});const p=s.safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Status must be APPROVED or REJECTED'});
 const c=await pool.connect();
 try {
  await c.query('BEGIN');
  const q=await c.query('SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE',[req.params.id]);
  const l=q.rows[0];if(!l)throw new Error('Leave request not found');if(l.status!=='PENDING')throw new Error('Request already decided');
  if(p.data.status==='APPROVED'){
   const b=await c.query(`SELECT COALESCE(SUM(amount),0) AS balance FROM leave_ledger WHERE employee_id=$1 AND leave_type=$2`,[l.employee_id,l.leave_type]);
   if(Number(b.rows[0].balance)<Number(l.days))throw new Error('Insufficient current balance');
   await c.query(`INSERT INTO leave_ledger(employee_id,leave_type,transaction_type,amount,reference_key,note,created_by)
    VALUES($1,$2,'DEBIT',$3,$4,$5,$6)`,[l.employee_id,l.leave_type,-Number(l.days),`leave-request:${l.id}`,`Approved leave request ${l.id}`,req.user!.id]);
  }
  const out=await c.query(`UPDATE leave_requests SET status=$1,approver_id=$2,decision_note=$3,decided_at=now() WHERE id=$4 RETURNING *`,
  [p.data.status,req.user!.id,p.data.decision_note||null,l.id]);
  await c.query('COMMIT');await audit(req.user!.id,'LEAVE_'+p.data.status,'leave_request',l.id,{});res.json(out.rows[0]);
 }catch(e:any){await c.query('ROLLBACK');res.status(400).json({error:e.message});}finally{c.release();}
}));

app.post('/api/attendance/check-in',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 if(!req.user!.employee_id)return res.status(400).json({error:'Employee account required'});
 const r=await pool.query(`INSERT INTO attendance(employee_id,work_date,check_in) VALUES($1,CURRENT_DATE,now())
 ON CONFLICT(employee_id,work_date) DO UPDATE SET check_in=COALESCE(attendance.check_in,now()) RETURNING *`,[req.user!.employee_id]);
 await audit(req.user!.id,'ATTENDANCE_CHECK_IN','attendance',r.rows[0].id,{});res.json(r.rows[0]);
}));
app.post('/api/attendance/check-out',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 if(!req.user!.employee_id)return res.status(400).json({error:'Employee account required'});
 const r=await pool.query(`UPDATE attendance SET check_out=now() WHERE employee_id=$1 AND work_date=CURRENT_DATE AND check_in IS NOT NULL AND check_out IS NULL RETURNING *`,[req.user!.employee_id]);
 if(!r.rows[0])return res.status(400).json({error:'No open check-in found for today'});await audit(req.user!.id,'ATTENDANCE_CHECK_OUT','attendance',r.rows[0].id,{});res.json(r.rows[0]);
}));
app.get('/api/attendance',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 const staff=req.user!.role!=='EMPLOYEE';
 const r=staff?await pool.query(`SELECT a.*,e.employee_code,e.first_name,e.last_name FROM attendance a JOIN employees e ON e.id=a.employee_id ORDER BY work_date DESC LIMIT 500`)
 :await pool.query(`SELECT * FROM attendance WHERE employee_id=$1 ORDER BY work_date DESC LIMIT 90`,[req.user!.employee_id]);
 res.json(r.rows);
}));

app.post('/api/employees/import',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{
 const {rows}=req.body as {rows:Record<string,any>[]};if(!Array.isArray(rows)||rows.length===0)return res.status(400).json({error:'Provide rows parsed from the employee template'});
 const results:any[]=[];
 for(const row of rows.slice(0,1000)){
  try{
   const email=String(row.email||'').trim().toLowerCase(),code=String(row.employee_code||'').trim();
   if(!email||!code||!row.first_name||!row.last_name)throw new Error('employee_code, first_name, last_name and email are required');
   if(String(row.role||'EMPLOYEE').toUpperCase()==='SUPER_ADMIN')throw new Error('Super-admin cannot be created through import');
   let deptId=null;if(row.department){const d=await pool.query(`INSERT INTO departments(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[String(row.department)]);deptId=d.rows[0].id;}
   let managerId=null;if(row.manager_email){const m=await pool.query('SELECT id FROM employees WHERE email=$1',[String(row.manager_email).trim().toLowerCase()]);if(!m.rows[0])throw new Error('manager_email not found');managerId=m.rows[0].id;}
   const e=await pool.query(`INSERT INTO employees(employee_code,first_name,last_name,email,phone,department_id,designation,joining_date,manager_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[code,String(row.first_name).trim(),String(row.last_name).trim(),email,row.phone||null,deptId,row.designation||null,row.joining_date||new Date().toISOString().slice(0,10),managerId]);
   const hash=await bcrypt.hash('Welcome123!',12);
   await pool.query(`INSERT INTO users(employee_id,email,password_hash,role) VALUES($1,$2,$3,$4)`,[e.rows[0].id,email,hash,String(row.role||'EMPLOYEE').toUpperCase()==='ADMIN'?'ADMIN':'EMPLOYEE']);
   results.push({email,status:'imported',temporary_password:'Welcome123!'});
  }catch(e:any){results.push({email:row.email||'',status:'error',message:e.message});}
 }
 await audit(req.user!.id,'EMPLOYEE_IMPORT','employee',null,{count:results.length});
 res.json({results,imported:results.filter(x=>x.status==='imported').length,failed:results.filter(x=>x.status==='error').length});
}));
app.get('/api/employees/export',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(_req:any,res:any)=>{
 const r=await pool.query(`SELECT e.employee_code,e.first_name,e.last_name,e.email,e.phone,d.name AS department,e.designation,e.joining_date,m.email AS manager_email,u.role
 FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.manager_id LEFT JOIN users u ON u.employee_id=e.id ORDER BY e.employee_code`);
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(r.rows),'Employees');
 const data=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Disposition','attachment; filename="hrms-employees.xlsx"');res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(data);
}));
app.get('/api/audit',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(_req:any,res:any)=>{
 const r=await pool.query(`SELECT a.*,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 200`);res.json(r.rows);
}));
app.get('/api/leave-policies',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(_req:any,res:any)=>{res.json((await pool.query('SELECT * FROM leave_policies ORDER BY leave_type')).rows)}));
app.put('/api/leave-policies/:type',authenticate,allow('SUPER_ADMIN'),asyncRoute(async(req:any,res:any)=>{
 const s=z.object({
  credit_day:z.coerce.number().int().min(1).max(28).default(25),
  credit_days:z.coerce.number().positive(),
  max_balance:z.coerce.number().positive().nullable().optional(),
  is_active:z.boolean()
 });
 const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid policy values. Credit day must be between 1 and 28.'});
 const r=await pool.query(
  `UPDATE leave_policies SET interval_days=30,credit_day=$1,credit_days=$2,max_balance=$3,is_active=$4
   WHERE leave_type=$5 RETURNING *`,
  [p.data.credit_day,p.data.credit_days,p.data.max_balance??null,p.data.is_active,req.params.type]
 );
 res.json(r.rows[0]||{error:'Policy not found'});
}));



// Employee self-service profile
app.get('/api/profile',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 if(!req.user!.employee_id)return res.status(400).json({error:'Account is not linked to an employee'});
 const r=await pool.query(`SELECT e.id,e.employee_code,e.first_name,e.last_name,e.email,e.phone,e.designation,e.joining_date,e.employment_status,e.date_of_birth,e.address,e.emergency_contact,e.bank_name,e.bank_account_last4,d.name AS department,m.first_name||' '||m.last_name AS manager_name
 FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees m ON m.id=e.manager_id WHERE e.id=$1`,[req.user!.employee_id]);res.json(r.rows[0]||{});
}));
app.patch('/api/profile',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 if(!req.user!.employee_id)return res.status(400).json({error:'Employee profile unavailable'});
 const s=z.object({phone:z.string().max(40).optional().nullable(),address:z.string().max(500).optional().nullable(),date_of_birth:z.string().optional().nullable(),emergency_contact:z.string().max(100).optional().nullable(),bank_name:z.string().max(100).optional().nullable(),bank_account_last4:z.string().max(4).optional().nullable()});
 const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid profile fields'});const d=p.data;
 const r=await pool.query(`UPDATE employees SET phone=COALESCE($1,phone),address=COALESCE($2,address),date_of_birth=$3,emergency_contact=COALESCE($4,emergency_contact),bank_name=COALESCE($5,bank_name),bank_account_last4=COALESCE($6,bank_account_last4),updated_at=now() WHERE id=$7 RETURNING *`,[d.phone??null,d.address??null,d.date_of_birth||null,d.emergency_contact??null,d.bank_name??null,d.bank_account_last4??null,req.user!.employee_id]);res.json(r.rows[0]);
}));

// Payroll: configure salary structure, generate on the 4th, salary date is the 5th.
async function generateMonthlyPayslips(monthDate?:string){
 const month=monthDate||new Date().toISOString().slice(0,7)+'-01';
 const employees=await pool.query(`SELECT e.id,e.phone,e.first_name,e.last_name,e.email,COALESCE(s.basic_salary,30000) basic_salary,COALESCE(s.travel_allowance,1500) travel_allowance,COALESCE(s.hra,9000) hra,COALESCE(s.food_allowance,1500) food_allowance,COALESCE(s.other_allowance,1000) other_allowance,COALESCE(s.tax_deduction,0) tax_deduction,COALESCE(s.pf_deduction,0) pf_deduction,COALESCE(s.other_deduction,0) other_deduction FROM employees e LEFT JOIN salary_structures s ON s.employee_id=e.id WHERE e.employment_status='ACTIVE'`);
 let generated=0;
 for(const e of employees.rows){
  const gross=['basic_salary','travel_allowance','hra','food_allowance','other_allowance'].reduce((a,k)=>a+Number(e[k]||0),0);
  const deductions=['tax_deduction','pf_deduction','other_deduction'].reduce((a,k)=>a+Number(e[k]||0),0);
  const net=gross-deductions; if(net<0)continue;
  const r=await pool.query(`INSERT INTO salary_slips(employee_id,pay_month,basic_salary,travel_allowance,hra,food_allowance,other_allowance,tax_deduction,pf_deduction,other_deduction,gross_pay,total_deductions,net_pay,payment_date)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,(date_trunc('month',$2::date)+interval '4 days')::date) ON CONFLICT(employee_id,pay_month) DO NOTHING RETURNING id`,[e.id,month,e.basic_salary,e.travel_allowance,e.hra,e.food_allowance,e.other_allowance,e.tax_deduction,e.pf_deduction,e.other_deduction,gross,deductions,net]);
  if(r.rows[0]){generated++;await pool.query(`INSERT INTO notifications(employee_id,title,message,notification_type) VALUES($1,'Payslip is ready','Your payslip has been generated. Sign in to your employee account to view or download it.','PAYSLIP')`,[e.id]);
   // Optional SMS: configure SMS_API_URL and SMS_API_TOKEN for a provider gateway accepting {to,message}.
   if(e.phone&&process.env.SMS_API_URL&&process.env.SMS_API_TOKEN){try{await fetch(process.env.SMS_API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.SMS_API_TOKEN}`},body:JSON.stringify({to:e.phone,message:'Your monthly salary slip is ready. Sign in to your employee account to view/download it. - HR'})});}catch(err){console.error('Payslip SMS delivery failed for',e.email,err);}}
  }
 }
 return generated;
}
app.get('/api/payroll/mine',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 if(!req.user!.employee_id)return res.status(400).json({error:'Employee account required'});
 const r=await pool.query(`SELECT s.id,s.pay_month,s.basic_salary,s.travel_allowance,s.hra,s.food_allowance,s.other_allowance,s.tax_deduction,s.pf_deduction,s.other_deduction,s.gross_pay,s.total_deductions,s.net_pay,s.generated_at,s.payment_date,e.employee_code,e.first_name,e.last_name,e.designation,e.email,d.name AS department FROM salary_slips s JOIN employees e ON e.id=s.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE s.employee_id=$1 ORDER BY s.pay_month DESC`,[req.user!.employee_id]);res.json(r.rows);
}));
app.get('/api/payroll/mine/:id',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{
 const r=await pool.query(`SELECT s.*,e.employee_code,e.first_name,e.last_name,e.designation,e.email,d.name AS department FROM salary_slips s JOIN employees e ON e.id=s.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE s.id=$1 AND s.employee_id=$2`,[req.params.id,req.user!.employee_id]);if(!r.rows[0])return res.status(404).json({error:'Payslip not found'});res.json(r.rows[0]);
}));
app.get('/api/payroll/structure',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(_req:any,res:any)=>{
 const r=await pool.query(`SELECT e.id,e.employee_code,e.first_name,e.last_name,e.email,e.phone,COALESCE(s.basic_salary,30000) basic_salary,COALESCE(s.travel_allowance,1500) travel_allowance,COALESCE(s.hra,9000) hra,COALESCE(s.food_allowance,1500) food_allowance,COALESCE(s.other_allowance,1000) other_allowance,COALESCE(s.tax_deduction,0) tax_deduction,COALESCE(s.pf_deduction,0) pf_deduction,COALESCE(s.other_deduction,0) other_deduction FROM employees e LEFT JOIN salary_structures s ON s.employee_id=e.id WHERE e.employment_status='ACTIVE' ORDER BY e.employee_code`);res.json(r.rows);
}));
app.put('/api/payroll/structure/:employeeId',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{
 const keys=['basic_salary','travel_allowance','hra','food_allowance','other_allowance','tax_deduction','pf_deduction','other_deduction'];const s=z.object(Object.fromEntries(keys.map(k=>[k,z.coerce.number().min(0)])) as any);const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Salary amounts must be zero or greater'});
 const d=p.data;const r=await pool.query(`INSERT INTO salary_structures(employee_id,basic_salary,travel_allowance,hra,food_allowance,other_allowance,tax_deduction,pf_deduction,other_deduction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(employee_id) DO UPDATE SET basic_salary=EXCLUDED.basic_salary,travel_allowance=EXCLUDED.travel_allowance,hra=EXCLUDED.hra,food_allowance=EXCLUDED.food_allowance,other_allowance=EXCLUDED.other_allowance,tax_deduction=EXCLUDED.tax_deduction,pf_deduction=EXCLUDED.pf_deduction,other_deduction=EXCLUDED.other_deduction,updated_at=now() RETURNING *`,[req.params.employeeId,...keys.map(k=>d[k])]);res.json(r.rows[0]);
}));
app.post('/api/payroll/generate',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(req:any,res:any)=>{const month=z.string().regex(/^\d{4}-\d{2}$/).safeParse(req.body.month||new Date().toISOString().slice(0,7));if(!month.success)return res.status(400).json({error:'Month must be YYYY-MM'});const count=await generateMonthlyPayslips(month.data+'-01');res.json({generated:count,month:month.data});}));
app.get('/api/holidays',authenticate,asyncRoute(async(_req:any,res:any)=>{res.json((await pool.query('SELECT * FROM holidays ORDER BY holiday_date')).rows)}));
app.get('/api/announcements',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{const aud=req.user!.role==='EMPLOYEE'?'EMPLOYEE':'ADMIN';res.json((await pool.query(`SELECT * FROM announcements WHERE published=true AND audience IN ('ALL',$1) ORDER BY created_at DESC LIMIT 50`,[aud])).rows)}));
app.post('/api/announcements',authenticate,allow('ADMIN','SUPER_ADMIN'),asyncRoute(async(req:AuthedRequest,res:any)=>{const p=z.object({title:z.string().min(3),body:z.string().min(3),audience:z.enum(['ALL','EMPLOYEE','ADMIN']).default('ALL')}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Title and message are required'});const r=await pool.query('INSERT INTO announcements(title,body,audience,created_by) VALUES($1,$2,$3,$4) RETURNING *',[p.data.title,p.data.body,p.data.audience,req.user!.id]);if(p.data.audience!=='ADMIN'){const emps=await pool.query(`SELECT id FROM employees WHERE employment_status='ACTIVE'`);for(const e of emps.rows)await pool.query(`INSERT INTO notifications(employee_id,title,message,notification_type) VALUES($1,$2,$3,'NEWS')`,[e.id,p.data.title,p.data.body]);}res.status(201).json(r.rows[0]);}));
app.get('/api/notifications',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{if(!req.user!.employee_id)return res.json([]);res.json((await pool.query('SELECT * FROM notifications WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user!.employee_id])).rows)}));
app.patch('/api/notifications/:id/read',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{await pool.query('UPDATE notifications SET read_at=now() WHERE id=$1 AND employee_id=$2',[req.params.id,req.user!.employee_id]);res.json({ok:true})}));
app.get('/api/handbook',authenticate,asyncRoute(async(_req:any,res:any)=>{res.json((await pool.query('SELECT * FROM handbook_documents WHERE published=true ORDER BY category,title')).rows)}));
app.get('/api/attendance/monthly-export',authenticate,asyncRoute(async(req:AuthedRequest,res:any)=>{const month=String(req.query.month||new Date().toISOString().slice(0,7));if(!/^\d{4}-\d{2}$/.test(month))return res.status(400).json({error:'Month must be YYYY-MM'});const staff=req.user!.role!=='EMPLOYEE';const q=staff?await pool.query(`SELECT e.employee_code,e.first_name,e.last_name,a.work_date,a.check_in,a.check_out,a.note FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE to_char(a.work_date,'YYYY-MM')=$1 ORDER BY e.employee_code,a.work_date`,[month]):await pool.query(`SELECT e.employee_code,e.first_name,e.last_name,a.work_date,a.check_in,a.check_out,a.note FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.employee_id=$2 AND to_char(a.work_date,'YYYY-MM')=$1 ORDER BY a.work_date`,[month,req.user!.employee_id]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(q.rows),'Attendance');const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});res.setHeader('Content-Disposition',`attachment; filename="attendance-${month}.xlsx"`);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf)}));

app.use((err:any,_req:any,res:any,_next:any)=>{console.error(err);res.status(500).json({error:'Unexpected server error'});});
const port=Number(process.env.PORT||4000);
cron.schedule('15 1 25 * *',()=>accrueLeaves().catch(e=>console.error('Monthly leave accrual failed',e)),{timezone:process.env.TZ||'Asia/Kolkata'});
cron.schedule('0 8 4 * *',()=>generateMonthlyPayslips().then(n=>console.log('Payslips generated:',n)).catch(e=>console.error('Payslip generation failed',e)),{timezone:process.env.TZ||'Asia/Kolkata'});
app.listen(port,()=>{console.log(`HRMS API listening on http://localhost:${port}`);accrueLeaves().catch(e=>console.error('Initial leave accrual failed',e));});
