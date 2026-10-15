import dotenv from 'dotenv'; dotenv.config();
import bcrypt from 'bcryptjs';
import { pool } from './db';
async function main() {
 const dept=await pool.query(`INSERT INTO departments(name) VALUES('People & Culture') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
 const rows=[
  {code:'EMP0001',first:'Super',last:'Admin',email:'superadmin@demo.local',role:'SUPER_ADMIN',designation:'System Owner'},
  {code:'EMP0002',first:'HR',last:'Admin',email:'admin@demo.local',role:'ADMIN',designation:'HR Manager'},
  {code:'EMP0003',first:'Demo',last:'Employee',email:'employee@demo.local',role:'EMPLOYEE',designation:'Software Engineer'}
 ];
 const ids:any={};
 for(const e of rows) {
  const emp=await pool.query(`INSERT INTO employees(employee_code,first_name,last_name,email,department_id,designation,joining_date)
   VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE - INTERVAL '100 days')
   ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id`,[e.code,e.first,e.last,e.email,dept.rows[0].id,e.designation]);
  ids[e.email]=emp.rows[0].id;
 }
 await pool.query('UPDATE employees SET manager_id=$1 WHERE email=$2',[ids['admin@demo.local'],'employee@demo.local']);
 const hash=await bcrypt.hash('ChangeMe123!',12);
 for(const e of rows) await pool.query(`INSERT INTO users(employee_id,email,password_hash,role,is_active)
  VALUES($1,$2,$3,$4,true)
  ON CONFLICT(email) DO UPDATE SET employee_id=EXCLUDED.employee_id, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, is_active=true`,[ids[e.email],e.email,hash,e.role]);
 console.log('Seed complete. Demo account passwords have been reset to ChangeMe123!.');
 console.log('SUPER_ADMIN: superadmin@demo.local');
 console.log('ADMIN:       admin@demo.local');
 console.log('EMPLOYEE:    employee@demo.local');
 await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1)});
