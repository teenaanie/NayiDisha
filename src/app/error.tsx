 'use client';
export default function ErrorPage({error,reset}:{error:Error;reset:()=>void}){return <main className="page"><h1>We could not complete that request</h1><p>{error.message}</p><button className="btn" onClick={reset}>Try again</button> <a href="/demo">Choose demo identity</a></main>;}
