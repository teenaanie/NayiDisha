import {sql} from '@/lib/db';
import {readQuery} from '@/lib/read-query';
import {tokenHash} from '@/lib/demo-password';
import {AccessForm} from '../../sign-in/forms';
export default async function Invitation({params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 const [a]=await readQuery(sql`SELECT entity_id,role FROM app.demo_account WHERE invite_hash=${tokenHash(token)} AND invite_expires_at>CURRENT_TIMESTAMP`);
 if(!a)return <main className="page"><h1>Invitation unavailable</h1><p>This link has expired, been replaced or already been accepted. Ask Operations for a new invitation.</p><a href="/sign-in">Already activated? Sign in</a></main>;
 return <main className="page"><h1>Welcome to your {a.role.toLowerCase()} account</h1><p>Your account ID: <strong>{a.entity_id}</strong>. Keep this ID for future sign-ins.</p><p>This demo invitation was provided by Operations. No email or WhatsApp message was sent. Choose a demo password of at least 10 characters.</p><AccessForm kind="invite" token={token}/></main>;
}
