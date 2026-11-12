import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type UserRecord = {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
};

export type PublicUser = Pick<UserRecord, "id" | "username" | "displayName">;

export type SignatureRecord = { signature: string; signedAt: string };

export type Agreement = {
  id: string;
  provider: string;
  customer: string;
  providerUserId: string | null;
  customerUserId: string | null;
  service: string;
  description: string;
  requirements: string;
  amount: number;
  createdAt: string;
  signatures: {
    provider: SignatureRecord | null;
    customer: SignatureRecord | null;
  };
  status: "awaiting_signatures" | "active";
  integrityHash: string | null;
};

export type PaymentRequest = {
  id: string;
  agreementId: string;
  providerUserId: string;
  completionStatement: string;
  requestedAmount: number;
  customerObjection: string | null;
  status: "awaiting_customer" | "completed" | "failed";
  initialAssessmentJson: string | null;
  assessmentJson: string | null;
  paypalRecipientEmail: string | null;
  paypalInvoiceId: string | null;
  paypalInvoiceUrl: string | null;
  paypalInvoiceStatus: string | null;
  paypalError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditEventType =
  | "agreement_created"
  | "provider_signed"
  | "customer_signed"
  | "agreement_activated"
  | "assessment_submitted"
  | "assessment_completed"
  | "assessment_failed"
  | "initial_assessment_passed"
  | "initial_assessment_stopped"
  | "customer_assessment_completed";

export type AuditEvent = {
  id: string;
  agreementId: string;
  eventType: AuditEventType;
  occurredAt: string;
  actorRole: "provider" | "customer" | "system" | null;
  details: Record<string, unknown>;
};

type LegacyAgreement = Pick<Agreement,
  "id" | "provider" | "customer" | "service" | "description" | "requirements" |
  "amount" | "createdAt" | "signatures" | "status" | "integrityHash"
>;

type AgreementRow = {
  id: string; provider: string; customer: string;
  provider_user_id: string | null; customer_user_id: string | null;
  service: string; description: string; requirements: string;
  amount: number; created_at: string; signatures_json: string;
  status: "awaiting_signatures" | "active"; integrity_hash: string | null;
};

type PaymentRequestRow = {
  id: string; agreement_id: string; provider_user_id: string;
  completion_statement: string; requested_amount: number;
  customer_objection: string | null; status: PaymentRequest["status"];
  initial_assessment_json: string | null; assessment_json: string | null; paypal_recipient_email: string | null;
  paypal_invoice_id: string | null; paypal_invoice_url: string | null;
  paypal_invoice_status: string | null; paypal_error: string | null;
  created_at: string; updated_at: string;
};

type AuditEventRow = {
  id: string; agreement_id: string; event_type: AuditEventType;
  occurred_at: string; actor_role: AuditEvent["actorRole"]; details_json: string;
};

const dataDirectory = path.join(process.cwd(), "data");
const databasePath = path.join(dataDirectory, "signpay.sqlite");
const legacyDataPath = path.join(dataDirectory, "agreements.json");

const globalForDatabase = globalThis as typeof globalThis & {
  signPayDatabase?: DatabaseSync;
  signPayDatabaseReady?: Promise<void>;
};

function getDatabase(): DatabaseSync {
  if (!globalForDatabase.signPayDatabase) {
    globalForDatabase.signPayDatabase = new DatabaseSync(databasePath);
    globalForDatabase.signPayDatabase.exec("PRAGMA journal_mode = WAL;");
    globalForDatabase.signPayDatabase.exec("PRAGMA foreign_keys = ON;");
    globalForDatabase.signPayDatabase.exec(`
      CREATE TABLE IF NOT EXISTS agreements (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        customer TEXT NOT NULL,
        service TEXT NOT NULL,
        description TEXT NOT NULL,
        requirements TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        created_at TEXT NOT NULL,
        signatures_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('awaiting_signatures', 'active')),
        integrity_hash TEXT
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('agreement_created','provider_signed','customer_signed',
          'agreement_activated','assessment_submitted','assessment_completed','assessment_failed',
          'initial_assessment_passed','initial_assessment_stopped','customer_assessment_completed')
        ),
        occurred_at TEXT NOT NULL,
        actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('provider','customer','system')),
        details_json TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (agreement_id) REFERENCES agreements(id)
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_agreement_time
      ON audit_events (agreement_id, occurred_at);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS payment_requests (
        id TEXT PRIMARY KEY,
        agreement_id TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        completion_statement TEXT NOT NULL,
        requested_amount REAL NOT NULL CHECK (requested_amount >= 0),
        customer_objection TEXT,
        status TEXT NOT NULL CHECK (status IN ('awaiting_customer','completed','failed')),
        initial_assessment_json TEXT,
        assessment_json TEXT,
        paypal_recipient_email TEXT,
        paypal_invoice_id TEXT,
        paypal_invoice_url TEXT,
        paypal_invoice_status TEXT,
        paypal_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (agreement_id) REFERENCES agreements(id),
        FOREIGN KEY (provider_user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_payment_requests_agreement
      ON payment_requests(agreement_id, created_at);
      CREATE TABLE IF NOT EXISTS paypal_webhook_events (
        event_id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_paypal_webhook_invoice
      ON paypal_webhook_events(invoice_id, received_at);
    `);

    const auditSchema = globalForDatabase.signPayDatabase
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_events'")
      .get() as { sql: string } | undefined;
    if (auditSchema && !auditSchema.sql.includes("initial_assessment_passed")) {
      globalForDatabase.signPayDatabase.exec(`
        BEGIN;
        ALTER TABLE audit_events RENAME TO audit_events_legacy;
        CREATE TABLE audit_events (
          id TEXT PRIMARY KEY,
          agreement_id TEXT NOT NULL,
          event_type TEXT NOT NULL CHECK (
            event_type IN ('agreement_created','provider_signed','customer_signed',
            'agreement_activated','assessment_submitted','assessment_completed','assessment_failed',
            'initial_assessment_passed','initial_assessment_stopped','customer_assessment_completed')
          ),
          occurred_at TEXT NOT NULL,
          actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('provider','customer','system')),
          details_json TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (agreement_id) REFERENCES agreements(id)
        );
        INSERT INTO audit_events SELECT * FROM audit_events_legacy;
        DROP TABLE audit_events_legacy;
        CREATE INDEX IF NOT EXISTS idx_audit_events_agreement_time
        ON audit_events (agreement_id, occurred_at);
        COMMIT;
      `);
    }

    const columns = globalForDatabase.signPayDatabase
      .prepare("PRAGMA table_info(agreements)").all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("provider_user_id")) {
      globalForDatabase.signPayDatabase.exec("ALTER TABLE agreements ADD COLUMN provider_user_id TEXT");
    }
    if (!names.has("customer_user_id")) {
      globalForDatabase.signPayDatabase.exec("ALTER TABLE agreements ADD COLUMN customer_user_id TEXT");
    }
    const paymentColumns = globalForDatabase.signPayDatabase
      .prepare("PRAGMA table_info(payment_requests)").all() as Array<{ name: string }>;
    const paymentNames = new Set(paymentColumns.map((column) => column.name));
    const paymentMigrations: Array<[string, string]> = [
      ["initial_assessment_json", "TEXT"],
      ["paypal_recipient_email", "TEXT"],
      ["paypal_invoice_id", "TEXT"],
      ["paypal_invoice_url", "TEXT"],
      ["paypal_invoice_status", "TEXT"],
      ["paypal_error", "TEXT"],
    ];
    for (const [column, type] of paymentMigrations) {
      if (!paymentNames.has(column)) {
        globalForDatabase.signPayDatabase.exec(`ALTER TABLE payment_requests ADD COLUMN ${column} ${type}`);
      }
    }
  }
  return globalForDatabase.signPayDatabase;
}

function rowToAgreement(row: AgreementRow): Agreement {
  return {
    id: row.id, provider: row.provider, customer: row.customer,
    providerUserId: row.provider_user_id, customerUserId: row.customer_user_id,
    service: row.service, description: row.description, requirements: row.requirements,
    amount: row.amount, createdAt: row.created_at,
    signatures: JSON.parse(row.signatures_json) as Agreement["signatures"],
    status: row.status, integrityHash: row.integrity_hash,
  };
}

function rowToPaymentRequest(row: PaymentRequestRow): PaymentRequest {
  return {
    id: row.id, agreementId: row.agreement_id, providerUserId: row.provider_user_id,
    completionStatement: row.completion_statement, requestedAmount: row.requested_amount,
    customerObjection: row.customer_objection, status: row.status,
    initialAssessmentJson: row.initial_assessment_json, assessmentJson: row.assessment_json, paypalRecipientEmail: row.paypal_recipient_email,
    paypalInvoiceId: row.paypal_invoice_id, paypalInvoiceUrl: row.paypal_invoice_url,
    paypalInvoiceStatus: row.paypal_invoice_status, paypalError: row.paypal_error,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function ensureDatabaseReady(): Promise<void> {
  if (!globalForDatabase.signPayDatabaseReady) {
    globalForDatabase.signPayDatabaseReady = (async () => {
      await mkdir(dataDirectory, { recursive: true });
      const db = getDatabase();
      const migration = db.prepare("SELECT name FROM schema_migrations WHERE name = ?")
        .get("import-agreements-json-v1") as { name: string } | undefined;
      if (!migration) {
        let legacy: LegacyAgreement[] = [];
        try {
          const parsed: unknown = JSON.parse(await readFile(legacyDataPath, "utf8"));
          if (!Array.isArray(parsed)) throw new Error("The existing agreements file has an invalid format.");
          legacy = parsed as LegacyAgreement[];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const insert = db.prepare(`
          INSERT OR IGNORE INTO agreements
          (id,provider,customer,service,description,requirements,amount,created_at,
           signatures_json,status,integrity_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `);
        db.exec("BEGIN");
        try {
          for (const item of legacy) {
            insert.run(
              item.id, item.provider, item.customer, item.service, item.description,
              item.requirements, item.amount, item.createdAt, JSON.stringify(item.signatures),
              item.status, item.integrityHash
            );
          }
          db.prepare("INSERT INTO schema_migrations(name,applied_at) VALUES(?,?)")
            .run("import-agreements-json-v1", new Date().toISOString());
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      }
      db.prepare("INSERT OR IGNORE INTO schema_migrations(name,applied_at) VALUES(?,?)")
        .run("auth-and-payment-workflow-v1", new Date().toISOString());
    })().catch((error) => {
      globalForDatabase.signPayDatabaseReady = undefined;
      throw error;
    });
  }
  await globalForDatabase.signPayDatabaseReady;
}

export function generateIntegrityHash(agreement: Agreement): string {
  const terms = {
    id: agreement.id, provider: agreement.provider, customer: agreement.customer,
    providerUserId: agreement.providerUserId, customerUserId: agreement.customerUserId,
    service: agreement.service, description: agreement.description,
    requirements: agreement.requirements, amount: agreement.amount,
    createdAt: agreement.createdAt, signatures: agreement.signatures,
  };
  return createHash("sha256").update(JSON.stringify(terms)).digest("hex");
}

export function createUser(user: UserRecord): void {
  getDatabase().prepare(`
    INSERT INTO users(id,username,display_name,password_hash,created_at)
    VALUES(?,?,?,?,?)
  `).run(user.id, user.username, user.displayName, user.passwordHash, user.createdAt);
}

export function getUserByUsername(username: string): UserRecord | null {
  const row = getDatabase().prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as { id: string; username: string; display_name: string; password_hash: string; created_at: string } | undefined;
  return row ? {
    id: row.id, username: row.username, displayName: row.display_name,
    passwordHash: row.password_hash, createdAt: row.created_at,
  } : null;
}

export function getUserById(id: string): PublicUser | null {
  const row = getDatabase().prepare("SELECT id,username,display_name FROM users WHERE id = ?")
    .get(id) as { id: string; username: string; display_name: string } | undefined;
  return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
}

export function createSession(tokenHash: string, userId: string, expiresAt: string): void {
  const now = new Date().toISOString();
  getDatabase().prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .run(tokenHash, userId, expiresAt, now);
}

export function getSessionUserId(tokenHash: string): string | null {
  const row = getDatabase().prepare("SELECT user_id,expires_at FROM sessions WHERE token_hash = ?")
    .get(tokenHash) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    deleteSession(tokenHash);
    return null;
  }
  return row.user_id;
}

export function deleteSession(tokenHash: string): void {
  getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function createAgreement(agreement: Agreement): void {
  getDatabase().prepare(`
    INSERT INTO agreements
    (id,provider,customer,provider_user_id,customer_user_id,service,description,
     requirements,amount,created_at,signatures_json,status,integrity_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    agreement.id, agreement.provider, agreement.customer, agreement.providerUserId,
    agreement.customerUserId, agreement.service, agreement.description,
    agreement.requirements, agreement.amount, agreement.createdAt,
    JSON.stringify(agreement.signatures), agreement.status, agreement.integrityHash
  );
}

export function getAgreement(id: string): Agreement | null {
  const row = getDatabase().prepare("SELECT * FROM agreements WHERE id = ?")
    .get(id) as AgreementRow | undefined;
  return row ? rowToAgreement(row) : null;
}

export function getAgreementsForUser(userId: string): Agreement[] {
  const rows = getDatabase().prepare(`
    SELECT * FROM agreements
    WHERE provider_user_id = ? OR customer_user_id = ?
    ORDER BY created_at DESC
  `).all(userId, userId) as AgreementRow[];
  return rows.map(rowToAgreement);
}

export function saveAgreement(agreement: Agreement): void {
  getDatabase().prepare(`
    UPDATE agreements SET signatures_json=?,status=?,integrity_hash=? WHERE id=?
  `).run(JSON.stringify(agreement.signatures), agreement.status, agreement.integrityHash, agreement.id);
}

export function createPaymentRequest(request: Omit<PaymentRequest, "customerObjection" | "initialAssessmentJson" | "assessmentJson" | "updatedAt" | "paypalRecipientEmail" | "paypalInvoiceId" | "paypalInvoiceUrl" | "paypalInvoiceStatus" | "paypalError">): void {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO payment_requests
    (id,agreement_id,provider_user_id,completion_statement,requested_amount,
     customer_objection,status,assessment_json,created_at,updated_at)
    VALUES(?,?,?,?,?,NULL,?,NULL,?,?)
  `).run(
    request.id, request.agreementId, request.providerUserId,
    request.completionStatement, request.requestedAmount, request.status,
    request.createdAt, now
  );
}

export function getPaymentRequest(id: string): PaymentRequest | null {
  const row = getDatabase().prepare("SELECT * FROM payment_requests WHERE id = ?")
    .get(id) as PaymentRequestRow | undefined;
  return row ? rowToPaymentRequest(row) : null;
}

export function getLatestPaymentRequest(agreementId: string): PaymentRequest | null {
  const row = getDatabase().prepare(`
    SELECT * FROM payment_requests WHERE agreement_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(agreementId) as PaymentRequestRow | undefined;
  return row ? rowToPaymentRequest(row) : null;
}

export function saveInitialAssessment(
  id: string,
  assessment: Record<string, unknown>,
  awaitingCustomer: boolean
): void {
  getDatabase().prepare(`
    UPDATE payment_requests
    SET initial_assessment_json=?,assessment_json=?,status=?,updated_at=?
    WHERE id=?
  `).run(
    JSON.stringify(assessment),
    awaitingCustomer ? null : JSON.stringify(assessment),
    awaitingCustomer ? "awaiting_customer" : "completed",
    new Date().toISOString(),
    id
  );
}

export function completePaymentRequest(
  id: string,
  objection: string | null,
  status: PaymentRequest["status"],
  assessment: Record<string, unknown> | null
): void {
  getDatabase().prepare(`
    UPDATE payment_requests
    SET customer_objection=?,status=?,assessment_json=?,updated_at=?
    WHERE id=?
  `).run(objection, status, assessment ? JSON.stringify(assessment) : null, new Date().toISOString(), id);
}

export function updatePayPalInvoice(
  id: string,
  details: {
    recipientEmail: string | null;
    invoiceId: string | null;
    invoiceUrl: string | null;
    invoiceStatus: string;
    error: string | null;
  }
): void {
  getDatabase().prepare(`
    UPDATE payment_requests
    SET paypal_recipient_email=?,paypal_invoice_id=?,paypal_invoice_url=?,
        paypal_invoice_status=?,paypal_error=?,updated_at=?
    WHERE id=?
  `).run(
    details.recipientEmail, details.invoiceId, details.invoiceUrl,
    details.invoiceStatus, details.error, new Date().toISOString(), id
  );
}

export function appendAuditEvent(
  agreementId: string,
  eventType: AuditEventType,
  actorRole: AuditEvent["actorRole"] = "system",
  details: Record<string, unknown> = {}
): AuditEvent {
  const event: AuditEvent = {
    id: randomUUID(), agreementId, eventType, occurredAt: new Date().toISOString(),
    actorRole, details,
  };
  getDatabase().prepare(`
    INSERT INTO audit_events(id,agreement_id,event_type,occurred_at,actor_role,details_json)
    VALUES(?,?,?,?,?,?)
  `).run(event.id, event.agreementId, event.eventType, event.occurredAt, event.actorRole, JSON.stringify(event.details));
  return event;
}


/** Records a verified PayPal webhook once and updates the matching invoice status.
 * Returns a distinct result so the webhook handler can distinguish duplicates
 * from invoice IDs that do not belong to a SignPay payment request.
 */
export function recordPaidPayPalWebhook(input: {
  eventId: string;
  eventType: string;
  invoiceId: string;
  payload: Record<string, unknown>;
}): "recorded" | "duplicate" | "unmatched" {
  const db = getDatabase();
  const matching = db.prepare(
    "SELECT id FROM payment_requests WHERE paypal_invoice_id = ?"
  ).get(input.invoiceId) as { id: string } | undefined;
  if (!matching) return "unmatched";

  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO paypal_webhook_events
      (event_id, invoice_id, event_type, received_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.eventId, input.invoiceId, input.eventType,
      new Date().toISOString(), JSON.stringify(input.payload));
    if (Number(inserted.changes) === 0) {
      db.exec("COMMIT");
      return "duplicate";
    }
    db.prepare(`
      UPDATE payment_requests
      SET paypal_invoice_status = 'PAID', paypal_error = NULL, updated_at = ?
      WHERE paypal_invoice_id = ?
    `).run(new Date().toISOString(), input.invoiceId);
    db.exec("COMMIT");
    return "recorded";
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
