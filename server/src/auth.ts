import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db';
export type Role = 'SUPER_ADMIN'|'ADMIN'|'EMPLOYEE';
export interface AuthedRequest extends Request { user?: { id:string; role:Role; employee_id:string|null; email:string } }
export async function authenticate(req:AuthedRequest,res:Response,next:NextFunction) {
  try {
    const header=req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({error:'Authentication required'});
    const payload=jwt.verify(header.slice(7),process.env.JWT_SECRET || '') as {sub:string};
    const result=await pool.query('SELECT id,email,role,employee_id,is_active FROM users WHERE id=$1',[payload.sub]);
    if (!result.rows[0] || !result.rows[0].is_active) return res.status(401).json({error:'Account unavailable'});
    req.user={id:result.rows[0].id,email:result.rows[0].email,role:result.rows[0].role,employee_id:result.rows[0].employee_id};
    next();
  } catch { return res.status(401).json({error:'Invalid or expired token'}); }
}
export function allow(...roles:Role[]) {
 return (req:AuthedRequest,res:Response,next:NextFunction)=> {
   if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({error:'Insufficient permissions'});
   next();
 };
}
export async function audit(actor:string,action:string,type:string,id:string|null,details:unknown={}) {
 await pool.query('INSERT INTO audit_events(actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',[actor,action,type,id,JSON.stringify(details)]);
}
