'use client';
export function ExportButton(){return <div className="btnrow nd-report-actions"><a className="btn btn-primary" href="/ops/reports/download" download>Download CSV</a><button className="btn" onClick={()=>window.print()}>Print report</button></div>;}
