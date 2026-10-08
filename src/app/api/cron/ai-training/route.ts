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
 // Leave room for a review step that starts near the end of the budget (each takes up to ~4 minutes).
 const r=await trainingCronTick(new Date(),20000);
 // Simulated-candidate runs left unfinished (nobody kept the page open) move on here too.
 const simulations=await advanceSimRuns(150000);
 return NextResponse.json({ok:true,...r,simulations});
}
