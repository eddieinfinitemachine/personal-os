import {NextResponse} from 'next/server';
import {getCurrentUserId} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const userId=await getCurrentUserId(request);if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401});const {id}=await params;
 if(!await prisma.datingPerson.findFirst({where:{userId,id},select:{id:true}}))return NextResponse.json({error:'Not found'},{status:404});
 const records=await prisma.datingSuggestion.findMany({where:{userId,personId:id,status:'added',sourceRecord:{userId,status:'processed'}},orderBy:{createdAt:'desc'},include:{sourceRecord:{select:{occurredAt:true}}},take:100});
 return NextResponse.json({evidence:records.map(r=>({id:r.id,source:r.source,title:r.title,url:r.url,quote:r.note,occurredAt:r.sourceRecord?.occurredAt?.toISOString()??null})),limit:100},{headers:{'Cache-Control':'private, no-store'}});
}
