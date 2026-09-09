import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { Clause } from '../../ui';
import { NewPartnerForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NewPartnerPage() {
  const viewer=await scopePage('ops');
  const localities = await sql<{ key: string; display_name: string }[]>`
    SELECT key, display_name FROM app.locality ORDER BY display_name
  `;
  const roles = await sql<{ key: string; industry_key: string; display_name: string }[]>`
    SELECT key, industry_key, display_name FROM app.role_family ORDER BY industry_key, key
  `;
  return (
    <main className="page">
      <div className="page-head">
        <div className="flexb">
          <div>
            <h1>Add a sourcing partner</h1>
            <div className="sub">
              Creates the partner and its first site, with a QR token and a printable code
              {' '}<Clause>PART-01 / 03 / 04 / 05</Clause>
            </div>
          </div>
          <Link className="btn" href="/ops/partners">← Partners</Link>
        </div>
      </div>
      <p><Link href="/ops/manage/localities">Add a locality</Link> · <Link href="/ops/manage/roles">Add a sourcing capability</Link></p><NewPartnerForm localities={localities} roles={roles} />
    </main>
  );
}
