import Link from 'next/link';
import {notFound} from 'next/navigation';
import {scopePage} from '@/lib/auth';
import {sql} from '@/lib/db';
import {ManagedForm} from '../../../manage/form';
export default async function EditEmployer({params}:{params:Promise<{id:string}>}){
 await scopePage('ops');const {id}=await params;
 const [e]=await sql`SELECT id,legal_name,brand_name,gst_pan,billing_contact FROM app.employer_organisation WHERE id=${id}`;
 if(!e)notFound();
 return <main className="page"><div className="page-head flexb"><div><h1>Edit {e.brand_name}</h1><p>{e.id}</p></div><div className="btnrow"><Link className="btn btn-primary" href={`/employer/new-job?employer=${e.id}`}>+ Post a job for this employer</Link><Link className="btn" href="/ops/employers">← Employers</Link></div></div><section className="card card-body" style={{maxWidth:720}}><ManagedForm kind="employer" id={e.id}>{[['legal_name','Legal name'],['brand_name','Brand name'],['gst_pan','GST / PAN'],['billing_contact','Billing contact']].map(([key,label])=><label className="field" key={key}>{label}<input name={key} defaultValue={e[key]||''} required={['legal_name','brand_name'].includes(key)}/></label>)}</ManagedForm></section></main>;
}
