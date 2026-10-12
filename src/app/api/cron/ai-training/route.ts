import {NextResponse} from 'next/server';
import {trainingCronTick} from '@/modules/roleplay/service/training';
import {advanceSimRuns} from '@/modules/roleplay/service/simulation';

/**
 * Daily at 02:00 UTC (07:30 India), from vercel.json. On Mondays it starts the weekly AI
 * training run for each tenant; every day it advances runs still in progress, one Gemini
 * review step at a time, within this invocation's time.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without the secret configured the route
 * refuses, so it cannot be triggered from outside.
 */
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function GET(req:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret)return NextResponse.json({error:'CRON_SECRET is not configured.'},{status:503});
 if(req.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'Unauthorized'},{status:401});
 // Steps may start for 2.5 minutes, so a review and its final merge finish the same day (with 20
 // seconds, the weekly run of 12 Oct reviewed its sessions and then waited a day to merge).
 const start=Date.now();
 const r=await trainingCronTick(new Date(),150000);
 // Simulated-candidate runs left unfinished (nobody kept the page open) get the time that is left.
 const left=240000-(Date.now()-start);
 const simulations=left>60000?await advanceSimRuns(left):0;
 return NextResponse.json({ok:true,...r,simulations});
}
