 'use client';
export default function CandidateError({reset}:{reset:()=>void}) {
 return <main className="page"><h1>Candidate view could not load</h1><p>Your session may have expired, or the database may be unavailable. Try again, or open Demo identities to select your candidate account.</p><div className="btnrow"><button className="btn btn-primary" onClick={reset}>Try again</button><a className="btn" href="/demo">Demo identities</a><a className="btn" href="/wa">Candidate journey</a></div></main>;
}
