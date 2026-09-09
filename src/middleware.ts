import {NextRequest,NextResponse} from 'next/server';
export function middleware(req:NextRequest){const headers=new Headers(req.headers);headers.set('x-page-path',req.nextUrl.pathname);return NextResponse.next({request:{headers}});}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
