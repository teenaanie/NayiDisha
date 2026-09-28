import { sql } from '@/lib/db';

/**
 * Object storage for candidate files (resumes).
 *
 * Supabase Storage when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set: a
 * private bucket, reached with the service key from the server only, and read
 * back through short-lived signed URLs. Without them, files go to a Postgres
 * table, which is fine at demo scale and keeps the feature working anywhere the
 * database does. Raw fetch, no SDK, like every other adapter here.
 */

export const RESUME_MAX_BYTES = 4 * 1024 * 1024;
export const RESUME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export interface StorageProvider {
  readonly name: 'supabase' | 'database';
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** A URL to redirect to, or the bytes themselves. */
  read(key: string): Promise<{ url: string } | { bytes: Uint8Array; mime: string } | null>;
  remove(keys: string[]): Promise<void>;
}

class SupabaseStorage implements StorageProvider {
  readonly name = 'supabase' as const;
  private base = `${process.env.SUPABASE_URL!.replace(/\/$/, '')}/storage/v1`;
  private bucket = process.env.SUPABASE_RESUME_BUCKET || 'resumes';
  private headers = () => ({
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  });

  private async ensureBucket() {
    await fetch(`${this.base}/bucket`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ id: this.bucket, name: this.bucket, public: false, file_size_limit: RESUME_MAX_BYTES }),
    });
  }

  async put(key: string, bytes: Uint8Array, mime: string) {
    const upload = () => fetch(`${this.base}/object/${this.bucket}/${key}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': mime, 'x-upsert': 'true' },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(30000),
    });
    let res = await upload();
    // First upload on a fresh project: the private bucket does not exist yet.
    if (res.status === 400 || res.status === 404) { await this.ensureBucket(); res = await upload(); }
    if (!res.ok) throw new Error(`Could not store the file (storage returned ${res.status}).`);
  }

  async read(key: string) {
    const res = await fetch(`${this.base}/object/sign/${this.bucket}/${key}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: 300 }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.signedURL ? { url: `${this.base}${body.signedURL}` } : null;
  }

  async remove(keys: string[]) {
    if (!keys.length) return;
    await fetch(`${this.base}/object/${this.bucket}`, {
      method: 'DELETE',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: keys }),
    });
  }
}

class DatabaseStorage implements StorageProvider {
  readonly name = 'database' as const;
  async put(key: string, bytes: Uint8Array, mime: string) {
    await sql`INSERT INTO app.stored_object (key, mime, bytes) VALUES (${key}, ${mime}, ${Buffer.from(bytes)})
              ON CONFLICT (key) DO UPDATE SET mime=EXCLUDED.mime, bytes=EXCLUDED.bytes`;
  }
  async read(key: string) {
    const [row] = await sql<{ mime: string; bytes: Buffer }[]>`SELECT mime, bytes FROM app.stored_object WHERE key=${key}`;
    return row ? { bytes: new Uint8Array(row.bytes), mime: row.mime } : null;
  }
  async remove(keys: string[]) {
    if (keys.length) await sql`DELETE FROM app.stored_object WHERE key = ANY(${keys})`;
  }
}

export function storageProvider(name?: string): StorageProvider {
  if (name === 'database') return new DatabaseStorage();
  if (name === 'supabase' || (!name && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) return new SupabaseStorage();
  return new DatabaseStorage();
}

/** A file the candidate should replace; the message is safe to show them. */
export class FileRejected extends Error {}

/** Checks a resume by its content, not just the name the sender gave it. */
export function checkResume(bytes: Uint8Array, mime: string, filename: string): string {
  if (bytes.length < 8) throw new FileRejected('The resume file is empty.');
  if (bytes.length > RESUME_MAX_BYTES) throw new FileRejected('The resume must be 4 MB or smaller.');
  const ext = RESUME_TYPES[mime] ?? filename.toLowerCase().split('.').pop() ?? '';
  const head = Buffer.from(bytes.slice(0, 8));
  const isPdf = head.subarray(0, 5).toString() === '%PDF-';
  const isZip = head[0] === 0x50 && head[1] === 0x4b;            // .docx
  const isOle = head.readUInt32BE(0) === 0xd0cf11e0;             // legacy .doc
  if (ext === 'pdf' && isPdf) return 'application/pdf';
  if (ext === 'docx' && isZip) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc' && isOle) return 'application/msword';
  throw new FileRejected('Upload the resume as a PDF or Word document.');
}
