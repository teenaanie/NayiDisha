import {Suspense} from 'react';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireRole} from '@/lib/auth';
import {SubNav,OPS_TABS} from '../../../subnav';
import {catalogueSections} from '../catalogue-sections';
import {CatalogueContent} from '../catalogue-content';
export default async function Section({params}:{params:Promise<{section:string}>}){
 await requireRole(['ADMIN','OPERATIONS']);const {section}=await params;
 const selected=catalogueSections.find(s=>s.key===section);if(!selected)notFound();
 return <><SubNav tabs={OPS_TABS}/><main className="page"><div className="page-head"><h1>{selected.title}</h1><Link className="btn" href="/ops/manage">← Manage &amp; catalogue</Link></div><Suspense fallback={<p role="status">Loading {selected.title.toLowerCase()}…</p>}><CatalogueContent section={selected.key}/></Suspense></main></>;
}
