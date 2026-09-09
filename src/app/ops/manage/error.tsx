 'use client';
export default function CatalogueError({reset}:{reset:()=>void}){return <main className="page"><h1>Could not load this catalogue section</h1><p>Please retry. If it keeps failing, check the database connection and the Vercel log for this request.</p><button className="btn" onClick={reset}>Try again</button> <a className="btn" href="/ops/manage">Back to catalogue</a></main>;}
