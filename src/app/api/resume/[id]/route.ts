import { sql } from '@/lib/db';
import { identity } from '@/lib/auth';
import { storageProvider } from '@/modules/adapters/storage';

/**
 * Resume download. Only operations, the candidate themself, or an employer who
 * has unlocked that candidate may read it. Supabase files are served through a
 * five-minute signed URL; the database fallback streams the bytes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await identity();
  if (!actor) return new Response('Sign in to view this file.', { status: 401 });

  const [resume] = await sql`SELECT candidate_id, object_key, storage, filename, mime FROM app.candidate_resume WHERE id=${id}`;
  if (!resume?.object_key) return new Response('Not found', { status: 404 });

  let allowed = actor.role === 'ADMIN' || actor.role === 'OPERATIONS' || (actor.role === 'CANDIDATE' && actor.id === resume.candidate_id);
  if (!allowed && actor.role === 'EMPLOYER') {
    const [unlock] = await sql`SELECT 1 FROM app.qualified_lead_unlock WHERE employer_id=${actor.id} AND candidate_id=${resume.candidate_id} LIMIT 1`;
    allowed = !!unlock;
  }
  if (!allowed) return new Response('Not allowed', { status: 403 });

  const file = await storageProvider(resume.storage).read(resume.object_key);
  if (!file) return new Response('Not found', { status: 404 });
  if ('url' in file) return Response.redirect(file.url, 302);
  const safeName = String(resume.filename).replace(/[^\w.\- ]/g, '_');
  return new Response(Buffer.from(file.bytes), {
    headers: {
      'content-type': file.mime,
      'content-disposition': `attachment; filename="${safeName}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
