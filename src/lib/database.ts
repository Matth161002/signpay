import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

export type UserRecord = { id:string; username:string; displayName:string; passwordHash:string; createdAt:string };
export type PublicUser = Pick<UserRecord,"id"|"username"|"displayName">;
export type SignatureRecord = { signature:string; signedAt:string };
export type Agreement = {
  id:string; provider:string; customer:string; providerUserId:string|null; customerUserId:string|null;
  service:string; description:string; requirements:string; amount:number; createdAt:string;
  signatures:{provider:SignatureRecord|null;customer:SignatureRecord|null};
  status:"awaiting_signatures"|"active"; integrityHash:string|null;
};
export type PaymentRequest = {
  id:string; agreementId:string; providerUserId:string; completionStatement:string; requestedAmount:number;
  customerObjection:string|null; status:"awaiting_customer"|"completed"|"failed"; assessmentJson:string|null;
  paypalRecipientEmail:string|null; paypalInvoiceId:string|null; paypalInvoiceUrl:string|null;
  paypalInvoiceStatus:string|null; paypalError:string|null; createdAt:string; updatedAt:string;
};
export type AuditEventType = "agreement_created"|"provider_signed"|"customer_signed"|"agreement_activated"|"assessment_submitted"|"assessment_completed"|"assessment_failed";
export type AuditEvent = {id:string;agreementId:string;eventType:AuditEventType;occurredAt:string;actorRole:"provider"|"customer"|"system"|null;details:Record<string,unknown>};

type Row = Record<string, any>;
const globalDb = globalThis as typeof globalThis & { signPayPool?:Pool; signPayReady?:Promise<void> };
function pool():Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  if (!globalDb.signPayPool) globalDb.signPayPool = new Pool({connectionString:process.env.DATABASE_URL,max:5,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  return globalDb.signPayPool;
}
const mapUser=(r:Row):UserRecord=>({id:r.id,username:r.username,displayName:r.display_name,passwordHash:r.password_hash,createdAt:r.created_at});
const mapPublicUser=(r:Row):PublicUser=>({id:r.id,username:r.username,displayName:r.display_name});
const mapAgreement=(r:Row):Agreement=>({id:r.id,provider:r.provider,customer:r.customer,providerUserId:r.provider_user_id,customerUserId:r.customer_user_id,service:r.service,description:r.description,requirements:r.requirements,amount:Number(r.amount),createdAt:r.created_at,signatures:JSON.parse(r.signatures_json),status:r.status,integrityHash:r.integrity_hash});
const mapPayment=(r:Row):PaymentRequest=>({id:r.id,agreementId:r.agreement_id,providerUserId:r.provider_user_id,completionStatement:r.completion_statement,requestedAmount:Number(r.requested_amount),customerObjection:r.customer_objection,status:r.status,assessmentJson:r.assessment_json,paypalRecipientEmail:r.paypal_recipient_email,paypalInvoiceId:r.paypal_invoice_id,paypalInvoiceUrl:r.paypal_invoice_url,paypalInvoiceStatus:r.paypal_invoice_status,paypalError:r.paypal_error,createdAt:r.created_at,updatedAt:r.updated_at});

export async function ensureDatabaseReady():Promise<void>{
  if(!globalDb.signPayReady){
    globalDb.signPayReady=(async()=>{
      const p=pool();
      await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS agreements(id TEXT PRIMARY KEY,provider TEXT NOT NULL,customer TEXT NOT NULL,provider_user_id TEXT REFERENCES users(id),customer_user_id TEXT REFERENCES users(id),service TEXT NOT NULL,description TEXT NOT NULL,requirements TEXT NOT NULL,amount NUMERIC(12,2) NOT NULL CHECK(amount>0),created_at TEXT NOT NULL,signatures_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('awaiting_signatures','active')),integrity_hash TEXT);
      CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,agreement_id TEXT NOT NULL REFERENCES agreements(id),event_type TEXT NOT NULL,occurred_at TEXT NOT NULL,actor_role TEXT,details_json TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS idx_audit_events_agreement_time ON audit_events(agreement_id,occurred_at);
      CREATE TABLE IF NOT EXISTS payment_requests(id TEXT PRIMARY KEY,agreement_id TEXT NOT NULL REFERENCES agreements(id),provider_user_id TEXT NOT NULL REFERENCES users(id),completion_statement TEXT NOT NULL,requested_amount NUMERIC(12,2) NOT NULL CHECK(requested_amount>=0),customer_objection TEXT,status TEXT NOT NULL CHECK(status IN ('awaiting_customer','completed','failed')),assessment_json TEXT,paypal_recipient_email TEXT,paypal_invoice_id TEXT,paypal_invoice_url TEXT,paypal_invoice_status TEXT,paypal_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_payment_requests_agreement ON payment_requests(agreement_id,created_at);
      CREATE TABLE IF NOT EXISTS paypal_webhook_events(event_id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,event_type TEXT NOT NULL,received_at TEXT NOT NULL,payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_paypal_webhook_invoice ON paypal_webhook_events(invoice_id,received_at);`);
      const migration=await p.query("SELECT name FROM schema_migrations WHERE name=$1",["import-agreements-json-v1"]);
      if(migration.rowCount===0){
        let legacy:Row[]=[];
        try{const parsed:unknown=JSON.parse(await readFile(path.join(process.cwd(),"data","agreements.json"),"utf8"));if(!Array.isArray(parsed))throw new Error("Existing agreements file has an invalid format.");legacy=parsed as Row[];}
        catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
        const client=await p.connect();
        try{
          await client.query("BEGIN");
          for(const a of legacy){
            await client.query(`INSERT INTO agreements(id,provider,customer,service,description,requirements,amount,created_at,signatures_json,status,integrity_hash)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`,
              [a.id,a.provider,a.customer,a.service,a.description,a.requirements,a.amount,a.createdAt,JSON.stringify(a.signatures),a.status,a.integrityHash]);
          }
          await client.query("INSERT INTO schema_migrations(name,applied_at) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",["import-agreements-json-v1",new Date().toISOString()]);
          await client.query("COMMIT");
        }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
      }
      await p.query("INSERT INTO schema_migrations(name,applied_at) VALUES($1,$2) ON CONFLICT(name) DO NOTHING",["postgres-schema-v1",new Date().toISOString()]);
    })().catch(e=>{globalDb.signPayReady=undefined;throw e;});
  }
  await globalDb.signPayReady;
}
export function generateIntegrityHash(a:Agreement):string{
  const terms={id:a.id,provider:a.provider,customer:a.customer,providerUserId:a.providerUserId,customerUserId:a.customerUserId,service:a.service,description:a.description,requirements:a.requirements,amount:a.amount,createdAt:a.createdAt,signatures:a.signatures};
  return createHash("sha256").update(JSON.stringify(terms)).digest("hex");
}
export async function createUser(u:UserRecord):Promise<void>{await pool().query("INSERT INTO users(id,username,display_name,password_hash,created_at) VALUES($1,$2,$3,$4,$5)",[u.id,u.username,u.displayName,u.passwordHash,u.createdAt]);}
export async function getUserByUsername(username:string):Promise<UserRecord|null>{const r=await pool().query("SELECT * FROM users WHERE username=$1",[username]);return r.rows[0]?mapUser(r.rows[0]):null;}
export async function getUserById(id:string):Promise<PublicUser|null>{const r=await pool().query("SELECT id,username,display_name FROM users WHERE id=$1",[id]);return r.rows[0]?mapPublicUser(r.rows[0]):null;}
export async function createSession(tokenHash:string,userId:string,expiresAt:string):Promise<void>{await pool().query("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,$4)",[tokenHash,userId,expiresAt,new Date().toISOString()]);}
export async function getSessionUserId(tokenHash:string):Promise<string|null>{const r=await pool().query("SELECT user_id,expires_at FROM sessions WHERE token_hash=$1",[tokenHash]);const row=r.rows[0];if(!row)return null;if(Date.parse(row.expires_at)<=Date.now()){await deleteSession(tokenHash);return null;}return row.user_id;}
export async function deleteSession(tokenHash:string):Promise<void>{await pool().query("DELETE FROM sessions WHERE token_hash=$1",[tokenHash]);}
export async function createAgreement(a:Agreement):Promise<void>{await pool().query(`INSERT INTO agreements(id,provider,customer,provider_user_id,customer_user_id,service,description,requirements,amount,created_at,signatures_json,status,integrity_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[a.id,a.provider,a.customer,a.providerUserId,a.customerUserId,a.service,a.description,a.requirements,a.amount,a.createdAt,JSON.stringify(a.signatures),a.status,a.integrityHash]);}
export async function getAgreement(id:string):Promise<Agreement|null>{const r=await pool().query("SELECT * FROM agreements WHERE id=$1",[id]);return r.rows[0]?mapAgreement(r.rows[0]):null;}
export async function getAgreementsForUser(id:string):Promise<Agreement[]>{const r=await pool().query("SELECT * FROM agreements WHERE provider_user_id=$1 OR customer_user_id=$1 ORDER BY created_at DESC",[id]);return r.rows.map(mapAgreement);}
export async function saveAgreement(a:Agreement):Promise<void>{await pool().query("UPDATE agreements SET signatures_json=$1,status=$2,integrity_hash=$3 WHERE id=$4",[JSON.stringify(a.signatures),a.status,a.integrityHash,a.id]);}
export async function createPaymentRequest(r:Omit<PaymentRequest,"customerObjection"|"assessmentJson"|"updatedAt">):Promise<void>{const now=new Date().toISOString();await pool().query(`INSERT INTO payment_requests(id,agreement_id,provider_user_id,completion_statement,requested_amount,customer_objection,status,assessment_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,NULL,$6,NULL,$7,$8)`,[r.id,r.agreementId,r.providerUserId,r.completionStatement,r.requestedAmount,r.status,r.createdAt,now]);}
export async function getPaymentRequest(id:string):Promise<PaymentRequest|null>{const r=await pool().query("SELECT * FROM payment_requests WHERE id=$1",[id]);return r.rows[0]?mapPayment(r.rows[0]):null;}
export async function getLatestPaymentRequest(id:string):Promise<PaymentRequest|null>{const r=await pool().query("SELECT * FROM payment_requests WHERE agreement_id=$1 ORDER BY created_at DESC LIMIT 1",[id]);return r.rows[0]?mapPayment(r.rows[0]):null;}
export async function completePaymentRequest(id:string,objection:string|null,status:PaymentRequest["status"],assessment:Record<string,unknown>|null):Promise<void>{await pool().query("UPDATE payment_requests SET customer_objection=$1,status=$2,assessment_json=$3,updated_at=$4 WHERE id=$5",[objection,status,assessment?JSON.stringify(assessment):null,new Date().toISOString(),id]);}
export async function updatePayPalInvoice(id:string,d:{recipientEmail:string|null;invoiceId:string|null;invoiceUrl:string|null;invoiceStatus:string;error:string|null}):Promise<void>{await pool().query("UPDATE payment_requests SET paypal_recipient_email=$1,paypal_invoice_id=$2,paypal_invoice_url=$3,paypal_invoice_status=$4,paypal_error=$5,updated_at=$6 WHERE id=$7",[d.recipientEmail,d.invoiceId,d.invoiceUrl,d.invoiceStatus,d.error,new Date().toISOString(),id]);}
export async function appendAuditEvent(agreementId:string,eventType:AuditEventType,actorRole:AuditEvent["actorRole"]="system",details:Record<string,unknown>={}):Promise<AuditEvent>{const e:AuditEvent={id:randomUUID(),agreementId,eventType,occurredAt:new Date().toISOString(),actorRole,details};await pool().query("INSERT INTO audit_events(id,agreement_id,event_type,occurred_at,actor_role,details_json) VALUES($1,$2,$3,$4,$5,$6)",[e.id,e.agreementId,e.eventType,e.occurredAt,e.actorRole,JSON.stringify(e.details)]);return e;}
export async function recordPaidPayPalWebhook(input:{eventId:string;eventType:string;invoiceId:string;payload:Record<string,unknown>}):Promise<"recorded"|"duplicate"|"unmatched">{
  const client=await pool().connect();
  try{
    await client.query("BEGIN");
    const match=await client.query("SELECT id FROM payment_requests WHERE paypal_invoice_id=$1 FOR UPDATE",[input.invoiceId]);
    if(!match.rows[0]){await client.query("ROLLBACK");return "unmatched";}
    const inserted=await client.query("INSERT INTO paypal_webhook_events(event_id,invoice_id,event_type,received_at,payload_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO NOTHING RETURNING event_id",[input.eventId,input.invoiceId,input.eventType,new Date().toISOString(),JSON.stringify(input.payload)]);
    if(inserted.rowCount===0){await client.query("COMMIT");return "duplicate";}
    await client.query("UPDATE payment_requests SET paypal_invoice_status='PAID',paypal_error=NULL,updated_at=$1 WHERE paypal_invoice_id=$2",[new Date().toISOString(),input.invoiceId]);
    await client.query("COMMIT");return "recorded";
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
