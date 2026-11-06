import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { AnalysisSchema, MatchSchema } from '../src/lib/schema';

async function main() {
  if(!process.argv.includes('--allow-paid')) throw new Error('Live AI requests require --allow-paid');
  const base=process.env.EASYAPPLY_TEST_URL || 'http://127.0.0.1:3123';
  const out=process.env.EASYAPPLY_EVIDENCE_DIR || 'artifacts/live';
  await mkdir(out,{recursive:true});
  for(const [name,file,type] of [
    ['pdf','tests/fixtures/samples/garam-youth-rent-2026.pdf','application/pdf'],
    ['hwpx','tests/fixtures/notice.hwpx','application/hwp+zip'],
  ]) {
    const status=await fetch(base+'/api/status');
    const info=await status.json();
    // Checks whichever provider the deployment runs; the provider is recorded, not forced.
    if(!info.ready) throw new Error(`AI is not configured (${info.provider})`);
    const cookie=status.headers.get('set-cookie')?.split(';')[0] || '';
    const form=new FormData();form.append('files',new File([await readFile(file)],file.split('/').pop()!,{type}));
    const started=Date.now();
    const response=await fetch(base+'/api/analyze',{method:'POST',headers:{cookie},body:form,signal:AbortSignal.timeout(285000)});
    const result=await response.json();
    await writeFile(`${out}/${name}-analysis.json`,JSON.stringify(result,null,2));
    if(!response.ok) throw new Error(`${name}: ${response.status} ${result.error?.code}`);
    const analysis=AnalysisSchema.parse(result.analysis);
    console.log(JSON.stringify({case:name,step:'analysis',provider:result.provider,elapsed_ms:Date.now()-started,evidence:result.verification,title:analysis.title}));
    if(name==='pdf') {
      // Empty profiles are rejected; a note without answers keeps every criterion unanswered.
      const body={analysis,analysis_token:result.analysis_token,answers:{},extra:'자동 점검: 조건 답변 없음'};
      const matchResponse=await fetch(base+'/api/match',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(285000)});
      const matched=await matchResponse.json();
      await writeFile(`${out}/${name}-match.json`,JSON.stringify(matched,null,2));
      if(!matchResponse.ok)throw new Error(`Match failed: ${matched.error?.code}`);
      const m=MatchSchema.parse(matched.match);
      if(m.criteria.some(c=>c.status!=='check')) throw new Error('Unanswered criterion was decided');
      console.log(JSON.stringify({case:name,step:'match',provider:matched.provider,overall:m.overall,criteria:m.criteria.length,checklist:m.checklist.length}));
    }
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
