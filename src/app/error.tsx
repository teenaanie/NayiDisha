'use client';
import {Icon} from './ops/dashboard-icon';
export default function ErrorPage({error,reset}:{error:Error;reset:()=>void}){return <main className="page"><section className="card card-body nd-error-card"><Icon name="alert"/><h1>We couldn’t open this page.</h1><p>{error.message}</p><div className="btnrow"><button className="btn btn-primary" onClick={reset}>Try again</button><a className="btn" href="/demo">Choose demo identity</a></div></section></main>;}
