import {scopePage} from '@/lib/auth';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { Clause } from '../../ui';
import { NewEmployerForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NewEmployerPage() {
  const viewer=await scopePage('ops');
  const localities = await sql<{ key: string; display_name: string }[]>`
    SELECT key, display_name FROM app.locality ORDER BY display_name
  `;
  return (
    <main className="page">
      <div className="page-head">
        <div className="flexb">
          <div>
            <h1>Add an employer</h1>
            <div className="sub">
              Creates the organisation, its first branch and a company administrator
              {' '}<Clause>OPS-EMP-01 / 02 / 03</Clause>
            </div>
          </div>
          <Link className="btn" href="/ops/employers">← Employers</Link>
        </div>
      </div>
      <NewEmployerForm localities={localities} />
    </main>
  );
}
