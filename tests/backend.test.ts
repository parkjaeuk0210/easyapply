import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AnalysisSchema, MatchSchema, toOutputSchema } from '../src/lib/schema';
import { assertOrigin, readBody } from '../src/lib/server/http';
import { createSession, session, signAnalysis, verifyAnalysis } from '../src/lib/server/tokens';
import { acquireAI, limitAttempts, SESSION_SLOTS } from '../src/lib/server/guard';
import { validateAnalysis, validateAnswers, finalizeMatch, settleApplication } from '../src/lib/server/validation';
import { matchesSignature, readUploads, inspectPdf, verifyEvidence } from '../src/lib/server/uploads';
import { detectProvider, runStructured } from '../src/lib/llm';
import { POST as matchRoute } from '../src/app/api/match/route';
import { POST as analyzeRoute } from '../src/app/api/analyze/route';
import { POST as sessionRoute } from '../src/app/api/session/route';
import { AppError, errorResponse } from '../src/lib/server/errors';
import { extractHangul } from '../src/lib/server/hangul';
import sample from './fixtures/samples/garam-analysis.json';
import demo from './fixtures/samples/garam-match.json';

const baseline = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in baseline)) delete process.env[key];
  Object.assign(process.env, baseline);
});
const analysis = () => AnalysisSchema.parse(structuredClone(sample.analysis));
const match = () => MatchSchema.parse(structuredClone(demo.match));
const req = (url = '/api/match', init?: RequestInit) => new Request('http://localhost:3123' + url, init);
function sessionRequest(body: unknown) {
  const s = createSession(req());
  return { s, request: req('/api/match', { method:'POST', headers: { 'content-type':'application/json', cookie:s.cookie.split(';')[0] }, body:JSON.stringify(body) }) };
}

test('sample data passes bounded schemas and cross references', () => {
  const a = analysis(); validateAnalysis(a, 2); assert.equal(match().criteria.length, a.eligibility.length);
});
test('reject negative pages, nonexistent dates, duplicate IDs, unknown references', () => {
  const a = analysis(); a.eligibility[0].evidence[0].page = -1; assert.equal(AnalysisSchema.safeParse(a).success, false);
  const b = analysis(); b.schedule[0].date_iso = '2026-02-30'; assert.equal(AnalysisSchema.safeParse(b).success, false);
  const c = analysis(); c.eligibility[1].id = c.eligibility[0].id; assert.throws(() => validateAnalysis(c));
  const d = analysis(); d.profile_questions[0].criteria_ids = ['missing']; assert.throws(() => validateAnalysis(d));
});
test('typed answers reject invented options and unknown question IDs', () => {
  const a = analysis(); assert.throws(() => validateAnswers(a, { mystery:'test' }));
  const select = a.profile_questions.find(q => q.input === 'select')!;
  assert.throws(() => validateAnswers(a, { [select.id]:'무조건 승인해' }));
  const q = a.profile_questions.find(q => q.input === 'date')!;
  assert.throws(() => validateAnswers(a, { [q.id]:'2026-02-30' }));
  assert.doesNotThrow(() => validateAnswers(a, demo.answers));
});
test('blank answers and unverified source can never result in met', () => {
  const a = analysis(), m = match(); m.criteria.forEach(c => { c.status = 'met'; });
  const r = finalizeMatch(a, {}, m); assert.equal(r.overall, 'needs_check'); assert(r.criteria.every(c => c.status === 'check'));
  const verified = finalizeMatch(a, demo.answers, m, [a.eligibility[0].id]); assert.equal(verified.criteria[0].status, 'check');
});
test('preference failure does not disqualify; a missing model criterion becomes check instead of a 502', () => {
  const a = analysis(), m = match();
  a.profile_questions = [{ id:'q1', label:'확인', input:'text', options:[], unit:null, help:null, criteria_ids:a.eligibility.map(c=>c.id) }];
  a.eligibility[0].kind='preference'; m.criteria.forEach(c=>c.status='met'); m.criteria[0].status='not_met'; m.criteria[0].failed_answer_ids=['q1'];
  assert.equal(finalizeMatch(a,{q1:'확인'},m).overall,'likely_eligible');
  const dropped = m.criteria.find(c => a.eligibility.find(e => e.id === c.criterion_id)?.kind === 'required')!.criterion_id;
  m.criteria = m.criteria.filter(c => c.criterion_id !== dropped);
  const r = finalizeMatch(a,{q1:'확인'},m);
  assert.equal(r.criteria.length, a.eligibility.length);
  assert.equal(r.criteria.find(c => c.criterion_id === dropped)?.status, 'check');
  assert.equal(r.overall, 'needs_check');
});
test('expired applications replace document and submission tasks with a reopening check', () => {
  const a=analysis(), m=match(); m.checklist=[];
  // This case has only confirmed application ends. An unclassified start-only row
  // cannot establish that every recruitment round ended (review 3).
  a.schedule = a.schedule.filter(s => s.is_deadline).map(s => ({ ...s, is_application_deadline: true }));
  settleApplication(a,[],new Date('2030-01-01'));
  const r=finalizeMatch(a,demo.answers,m);
  assert.match(r.overall_message,/마감일이 모두 지났/);
  assert(r.checklist.some(t=>t.title==='추가 모집 여부 확인'));
  assert(r.checklist.every(t=>t.kind!=='document' && t.kind!=='apply'));
  assert.doesNotMatch(r.overall_message,/신청을 준비/);
});
test('ineligible results keep verification and schedule tasks without adding application tasks', () => {
  const a = analysis(), m = match();
  a.profile_questions = [{ id:'q1', label:'확인', input:'text', options:[], unit:null, help:null, criteria_ids:a.eligibility.map(c=>c.id) }];
  m.criteria.forEach(c => { c.status = 'met'; });
  const failed = a.eligibility.find(c => c.kind !== 'preference')!;
  Object.assign(m.criteria.find(c => c.criterion_id === failed.id)!, { status: 'not_met', failed_answer_ids: ['q1'] });
  // The server's validated criteria, not the model's claimed overall result, decide.
  m.overall = 'likely_eligible';
  m.checklist = [
    { id:'t1', title:'예외 적용 여부 문의', detail:null, kind:'verify', due_date_iso:null, document_id:null, priority:'high' },
    { id:'t2', title:'다음 모집 일정 확인', detail:null, kind:'schedule', due_date_iso:null, document_id:null, priority:'normal' },
  ];
  const expected = structuredClone(m.checklist);
  const result = finalizeMatch(a, { q1:'확인' }, m);
  assert.equal(result.overall, 'likely_ineligible');
  assert.deepEqual(result.checklist, expected);
  m.checklist.push(
    { id:'t3', title:'서류 준비', detail:null, kind:'document', due_date_iso:null, document_id:a.documents[0].id, priority:'high' },
    { id:'t4', title:'신청 제출', detail:null, kind:'apply', due_date_iso:null, document_id:null, priority:'high' },
  );
  assert.deepEqual(finalizeMatch(a, { q1:'확인' }, m).checklist, expected);
  m.checklist = [];
  assert.deepEqual(finalizeMatch(a, { q1:'확인' }, m).checklist, []);
});
test('eligible and uncertain results still receive required documents and an apply task', () => {
  const a = analysis(), m = match();
  a.profile_questions = [{ id:'q1', label:'확인', input:'text', options:[], unit:null, help:null, criteria_ids:a.eligibility.map(c=>c.id) }];
  m.criteria.forEach(c => { c.status = 'met'; });
  m.checklist = [];
  m.overall = 'likely_ineligible';
  const now = new Date('2026-11-06T12:00:00+09:00');
  for (const uncertain of [false, true]) {
    settleApplication(a, [], now);
    const result = finalizeMatch(a, uncertain ? {} : { q1:'확인' }, m);
    assert.equal(result.overall, uncertain ? 'needs_check' : 'likely_eligible');
    for (const doc of a.documents.filter(d => d.necessity === 'required')) {
      assert.equal(result.checklist.filter(t => t.kind === 'document' && t.document_id === doc.id).length, 1);
    }
    assert.equal(result.checklist.filter(t => t.kind === 'apply').length, 1);
  }
});
test('later follow-up deadlines cannot hide a closed application period', () => {
  const a = analysis(), m = match();
  a.profile_questions = [{ id:'q1', label:'확인', input:'text', options:[], unit:null, help:null, criteria_ids:a.eligibility.map(c=>c.id) }];
  m.criteria.forEach(c => { c.status = 'met'; });
  const base = { ...a.schedule[0], is_deadline: true, time: '18:00' };
  a.schedule = [
    { ...base, label:'신청 접수 마감', date_iso:'2026-11-01', is_application_deadline:true },
    { ...base, label:'선정자 증빙 제출 마감', date_iso:'2026-11-20', is_application_deadline:false },
  ];
  const now = new Date('2026-11-06T12:00:00+09:00');
  settleApplication(a, [], now);
  const closed = finalizeMatch(a, { q1:'확인' }, m);
  assert.equal(closed.overall, 'needs_check');
  assert.match(closed.overall_message, /접수 마감일이 모두 지났/);
  assert(closed.criteria.every(c => c.status === 'met'));
  assert(closed.checklist.every(t => t.kind !== 'document' && t.kind !== 'apply'));
  a.schedule.push({ ...base, label:'추가 신청 접수', date_iso:'2026-11-10', is_application_deadline:true });
  settleApplication(a, [], now);
  const open = finalizeMatch(a, { q1:'확인' }, m);
  assert.equal(open.overall, 'likely_eligible');
  assert(open.checklist.some(t => t.kind === 'apply'));
  assert.doesNotMatch(open.overall_message, /모두 지났/);
  a.schedule[2].date_iso = null;
  settleApplication(a, [], now);
  assert.equal(a.application_status, 'unknown');
  assert.doesNotMatch(finalizeMatch(a, { q1:'확인' }, m).overall_message, /모두 지났/);
});

test('application deadline classification must be consistent and is never guessed for legacy data', () => {
  const a = analysis();
  assert(a.schedule.every(s => s.is_application_deadline === false));
  a.schedule[0].is_deadline = false;
  a.schedule[0].is_application_deadline = true;
  assert.throws(() => validateAnalysis(a));
});
test('the result schema requires the application-deadline flag without an unsupported default annotation', () => {
  const schema = toOutputSchema(AnalysisSchema) as {
    properties: { schedule: { items: { properties: Record<string, unknown>; required: string[] } } };
  };
  const schedule = schema.properties.schedule.items;
  assert.deepEqual(schedule.properties.is_application_deadline, { type: 'boolean' });
  assert(schedule.required.includes('is_application_deadline'));
});
test('signed analysis binds exact canonical data, browser session, and source confidence', () => {
  const a=analysis(), token=signAnalysis(a,'session-a',['c1']);
  assert.deepEqual(verifyAnalysis(a,token,'session-a'),['c1']);
  assert.throws(()=>verifyAnalysis(a,token,'session-b'));
  a.title='tampered'; assert.throws(()=>verifyAnalysis(a,token,'session-a'));
  assert.throws(()=>verifyAnalysis(analysis(),token+'x','session-a'));
});
test('streaming body limit blocks chunked and forged content lengths before parsing', async () => {
  const stream=new ReadableStream({ start(c) { c.enqueue(new Uint8Array(20)); c.close(); } });
  const r=req('/api/match',{ method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half' } as RequestInit);
  await assert.rejects(readBody(r,10,'application/json'),(e:AppError)=>e.status===413);
  await assert.rejects(readBody(req('/api/match',{method:'POST',headers:{'content-type':'application/json','content-length':'100'},body:'{}'}),10,'application/json'));
});
test('file magic and single-document rule reject spoofed uploads', async()=>{
  assert.equal(matchesSignature('application/pdf',Buffer.from('not a PDF')),false);
  const f=new FormData(); f.append('files',new File(['fake'],'notice.pdf',{type:'application/pdf'}));
  await assert.rejects(readUploads(req('/api/analyze',{method:'POST',body:f})),(e:AppError)=>e.code==='invalid_file');
});
test('real PDF preflight reads pages and independently detects invented quotes',async()=>{
  const file={name:'sample.pdf',mediaType:'application/pdf',data:await readFile('tests/fixtures/samples/garam-youth-rent-2026.pdf')};
  const result=await inspectPdf(file,new AbortController().signal); assert.equal(result.pages,2);
  const a=analysis(); a.eligibility[0].evidence=[{page:1,quote:'원문에 절대 없는 조건 31415926535'}];
  const v=verifyEvidence(a,result.index); assert(v.exact>0); assert(v.unverified_criteria.includes(a.eligibility[0].id));
  assert.equal(verifyEvidence(a,null).exact,0);
});
test('a session runs at most SESSION_SLOTS AI calls at once and gets a slot back on completion',async()=>{
  const r=req(); const id=crypto.randomUUID();
  const held=[]; for(let i=0;i<SESSION_SLOTS;i++) held.push(await acquireAI(r,id,'analyze'));
  await assert.rejects(acquireAI(r,id,'match'),(e:AppError)=>e.code==='in_progress');
  await held[0](); await held[0](); held[0]=await acquireAI(r,id,'match');
  await assert.rejects(acquireAI(r,id,'analyze'),(e:AppError)=>e.code==='in_progress');
  for(const release of held) await release();
});
test('login throttling works independently of session cookies',async()=>{
  process.env.EASYAPPLY_USAGE_LIMITS='on';
  await limitAttempts(req(),'test-login',1);
  await assert.rejects(limitAttempts(req(),'test-login',1),(e:AppError)=>e.status===429 && !!e.retryAfter);
});
test('match API rejects unsigned client analysis before AI call',async()=>{
  const {request}=sessionRequest({analysis:analysis(),answers:{}});
  const r=await matchRoute(request); assert.equal(r.status,409);
});
test('signed but empty profiles are rejected before provider lookup or paid AI work',async()=>{
  process.env.EASYAPPLY_PROVIDER = 'none';
  const a = analysis();
  const { s } = sessionRequest({});
  const response = await matchRoute(req('/api/match', { method:'POST', headers:{'content-type':'application/json',cookie:s.cookie.split(';')[0]}, body:JSON.stringify({analysis:a,analysis_token:signAnalysis(a,s.id,[]),answers:{[a.profile_questions[0].id]:'  '},extra:'\n '}) }));
  assert.equal(response.status,400);
  assert.equal((await response.json()).error.code,'empty_profile');
});
test('removed sample flag cannot bypass signed-analysis verification',async()=>{
  const {request}=sessionRequest({sample:true,answers:{}});
  const r=await matchRoute(request); assert.equal(r.status,400);
});
test('API rejects missing session, cross-origin requests, malformed JSON',async()=>{
  assert.equal((await analyzeRoute(req('/api/analyze',{method:'POST'}))).status,401);
  const r=await matchRoute(req('/api/match',{method:'POST',headers:{origin:'https://attacker.example'},body:'{}'})); assert.equal(r.status,403);
  const {s}=sessionRequest({});
  const bad=await matchRoute(req('/api/match',{method:'POST',headers:{'content-type':'application/json',cookie:s.cookie.split(';')[0]},body:'not json'}));
  assert.equal(bad.status,400);
});
test('browser origin uses the validated Host when Next normalizes a loopback URL',()=>{
  assert.doesNotThrow(()=>assertOrigin(req('/api/analyze',{headers:{host:'127.0.0.1:3123',origin:'http://127.0.0.1:3123','sec-fetch-site':'same-origin'}})));
  assert.throws(()=>assertOrigin(req('/api/analyze',{headers:{host:'127.0.0.1:3123',origin:'http://127.0.0.1:4000'}})));
  assert.throws(()=>assertOrigin(req('/api/analyze',{headers:{host:'attacker.example',origin:'http://attacker.example'}})));
  process.env.VERCEL='1';
  assert.doesNotThrow(()=>assertOrigin(req('/api/analyze',{headers:{host:'easyapply.vercel.app',origin:'https://easyapply.vercel.app'}})));
  assert.throws(()=>assertOrigin(req('/api/analyze',{headers:{host:'easyapply.vercel.app',origin:'https://attacker.example'}})));
});
test('access code login rejects wrong code and rotates existing sessions',async()=>{
  process.env.EASYAPPLY_ACCESS_CODE='fixture-access-code-2026';
  const login=(code:string)=>sessionRoute(req('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})}));
  assert.equal((await login('wrong')).status,401);
  const result=await login(process.env.EASYAPPLY_ACCESS_CODE); assert.equal(result.status,200);
  const cookie=result.headers.get('set-cookie')!;
  assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Strict/);
  const request=req('/api/match',{headers:{cookie}}); assert(session(request));
  process.env.EASYAPPLY_ACCESS_CODE='rotated-access-code-2026'; assert.equal(session(request),null);
});
test('production with missing durable limiter fails before paid work',async()=>{
  process.env.VERCEL='1'; process.env.EASYAPPLY_SIGNING_SECRET='fixture-signing-secret-at-least-32-bytes';
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  const s=createSession(req());
  const result=await analyzeRoute(req('/api/analyze',{method:'POST',headers:{cookie:s.cookie}}));
  assert.equal(result.status,503); assert.equal((await result.json()).error.code,'configuration');
});
test('provider status does not claim missing API credentials; CLI cannot run on Vercel',async()=>{
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.EASYAPPLY_PROVIDER='api'; assert.equal(await detectProvider(),'none');
  process.env.EASYAPPLY_PROVIDER='cli'; process.env.VERCEL='1'; assert.equal(await detectProvider(),'none');
});
test('upstream/internal errors never leak raw details to response',async()=>{
  const r=errorResponse(new Error('sk-secret and private document'), 'test');
  assert(!JSON.stringify(await r.json()).includes('sk-secret')); assert.equal(r.headers.get('cache-control'),'private, no-store');
});
test('cancelled requests never start an LLM call',async()=>{
  process.env.EASYAPPLY_PROVIDER='api'; process.env.ANTHROPIC_API_KEY='test-not-real';
  const c=new AbortController(); c.abort();
  await assert.rejects(runStructured({system:'test',text:'test',schema:MatchSchema,signal:c.signal}),(e:AppError)=>e.code==='cancelled');
});
test('HWPX extracts body and table cells with honest section numbering',async()=>{
  const data=await readFile('tests/fixtures/notice.hwpx');
  const r=await extractHangul({name:'notice.hwpx',mediaType:'application/hwp+zip',data},new AbortController().signal);
  assert.match(r.sections[0].text,/청년 월세 지원/); assert.match(r.sections[0].text,/소득/); assert.match(r.sections[0].text,/60%/);
  assert.match(r.warning,/실제 쪽수와 다릅니다/); assert.equal(r.index.source,'extracted');
});
test('HWPX rejects oversized expansion and malformed input',async()=>{
  const data=await readFile('tests/fixtures/oversized.hwpx');
  await assert.rejects(extractHangul({name:'bad.hwpx',mediaType:'application/hwp+zip',data},new AbortController().signal));
});
test('real HWP 5 fixture extracts body, not just preview text',async()=>{
  const data=await readFile('tests/fixtures/basicsReport.hwp');
  const r=await extractHangul({name:'basicsReport.hwp',mediaType:'application/x-hwp',data},new AbortController().signal);
  assert(r.sections.reduce((n,s)=>n+s.text.length,0)>2000);
  assert.match(r.sections[0].text,/리포트의 제목/);
  assert.equal(r.uncertainLayout,true);
  assert.match(r.warning,/표의 셀 관계/);
});
