 'use client';
import Link from 'next/link';import {useTransition} from 'react';import {useRouter} from 'next/navigation';
export function NavigationLink({href,children,className}:{href:string;children:React.ReactNode;className?:string}){
 const router=useRouter();const [pending,start]=useTransition();
 return <Link href={href} prefetch={false} className={className} aria-busy={pending} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();if(pending)return;start(()=>router.push(href));}}>{pending?'Opening…':children}</Link>;
}
