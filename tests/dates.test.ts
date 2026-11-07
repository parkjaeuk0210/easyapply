import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, daysUntil } from '../src/lib/dates';
import { settleApplication } from '../src/lib/server/validation';
import { AnalysisSchema } from '../src/lib/schema';
import sample from './fixtures/samples/garam-analysis.json';

test('calendar uses KST deadlines, positive event duration and UTF-8 folding', () => {
  const a = AnalysisSchema.parse(sample.analysis);
  a.title = '가'.repeat(100) + '\r\nBEGIN:VEVENT';
  a.schedule = [{ ...a.schedule[0], date_iso:'2026-12-31', time:'18:00' }];
  const ics = buildIcs(a,null);
  const unfolded = ics.replace(/\r\n /g,'');
  assert.match(unfolded,/DTSTART:20261231T090000Z/);
  assert.match(unfolded,/DTEND:20261231T091500Z/);
  assert.equal(ics.split('\r\n').filter(line=>line==='BEGIN:VEVENT').length,1);
  assert(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
  const uid = (text:string)=>text.match(/UID:([^\r]+)/)![1];
  assert.notEqual(uid(ics),uid(buildIcs({...a,title:'다른 공고'},null)));
});
test('date helpers reject invalid dates and choose last deadline independent of source order', () => {
  assert.equal(daysUntil('2026-02-30','2026-02-01'),null);
  assert.equal(daysUntil('2026-03-01','2026-02-28'),1);
  const a=AnalysisSchema.parse(sample.analysis);
  a.schedule=[{...a.schedule[0],is_deadline:true,is_application_deadline:true,date_iso:'2020-12-31'},{...a.schedule[0],is_deadline:true,is_application_deadline:true,date_iso:'2020-01-01'}];
  settleApplication(a,[]);
  assert.deepEqual([a.application_status,a.application_deadline_iso],['closed','2020-12-31']);
  assert.doesNotThrow(()=>buildIcs(a,null));
});

// 화면 자체 계산(mainDeadline)을 지웠으므로 같은 입력을 서버 접수 상태(settleApplication)로 검사한다.
test('application deadline stays closed when follow-up deadlines are still ahead', () => {
  const a = AnalysisSchema.parse(sample.analysis);
  const base = { ...a.schedule[0], is_deadline: true };
  a.schedule = [
    { ...base, label: '신청 접수 마감', date_iso: '2026-11-01', is_application_deadline: true },
    { ...base, label: '선정자 증빙 제출 마감', date_iso: '2026-11-20', is_application_deadline: false },
  ];
  const now = new Date('2026-11-06T12:00:00+09:00');
  settleApplication(a, [], now);
  assert.deepEqual([a.application_status, a.application_deadline_iso], ['closed', '2026-11-01']);
  a.schedule.shift();
  settleApplication(a, [], now);
  assert.deepEqual([a.application_status, a.application_deadline_iso], ['unknown', null]);
  // Additional application rounds remain eligible as application deadlines.
  a.schedule.push({ ...base, date_iso: '2026-11-10', is_application_deadline: true });
  settleApplication(a, [], now);
  assert.deepEqual([a.application_status, a.application_deadline_iso], ['open', '2026-11-10']);
});
