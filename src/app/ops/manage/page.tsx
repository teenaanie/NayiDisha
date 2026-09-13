import Link from 'next/link';
import {requireRole} from '@/lib/auth';

import {NavigationLink} from '../../navigation-link';
import {catalogueSections} from './catalogue-sections';
export default async function Manage(){
 await requireRole(['ADMIN','OPERATIONS']);
 return <><main className="page"><div className="page-head"><h1>Manage &amp; catalogue</h1><p>Choose what you want to manage. Each section opens separately.</p></div><div className="tilegrid">{catalogueSections.map(section=><NavigationLink key={section.key} className="tile" href={'/ops/manage/'+section.key}><h2>{section.title}</h2><p>{section.description}</p><span>Open →</span></NavigationLink>)}</div><section className="card card-body"><h2>Organisation records</h2><p>Edit the relevant record from its list.</p><div className="btnrow"><Link className="btn" href="/ops/employers">Employers</Link><Link className="btn" href="/ops/partners">Partners &amp; sites</Link></div></section></main></>;
}
