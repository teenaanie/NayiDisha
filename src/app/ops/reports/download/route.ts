import {scopePage} from '@/lib/auth';
import {dashboardData,metricDefinitions} from '../../dashboard-data';
import {now,fmtDateTime} from '@/lib/clock';
export async function GET(){
 try{await scopePage('ops');}catch{return new Response('Operations access required.',{status:403});}
 const {counts,jobs}=await dashboardData();
 const rows=[['Operations report',fmtDateTime(await now())+' IST','All time'],['Metric','Value','Definition'],...metricDefinitions.map(([key,label,description])=>[label,key==='referral_paise'?(Number(counts[key])/100).toFixed(2)+' INR':String(counts[key]),description]),...jobs.map(j=>['Jobs: '+j.status,String(j.n),'Current status'])];
 const csv=rows.map(row=>row.map(cell=>'"'+cell.replaceAll('"','""')+'"').join(',')).join('\r\n');
 return new Response('\ufeff'+csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="nayidisha-operations-report.csv"','Cache-Control':'private, no-store'}});
}
