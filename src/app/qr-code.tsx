 'use client';
import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
export function RealQr({token}:{token:string}){const [origin,setOrigin]=useState('');useEffect(()=>setOrigin(window.location.origin),[]);if(!origin)return <span>Preparing QR…</span>;const code=QRCode.create(origin+'/j/'+encodeURIComponent(token)),n=code.modules.size;return <svg role="img" aria-label="Scan to start the candidate journey" viewBox={`-4 -4 ${n+8} ${n+8}`} width="180" height="180"><rect x="-4" y="-4" width={n+8} height={n+8} fill="white"/>{Array.from(code.modules.data).map((v,i)=>v?<rect key={i} x={i%n} y={Math.floor(i/n)} width="1" height="1" fill="black"/>:null)}</svg>;}
