import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, daysUntil, mainDeadline } from '../src/lib/dates';
import { AnalysisSchema } from '../src/lib/schema';
import sample from '../public/samples/garam-analysis.json';

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
  a.schedule=[{...a.schedule[0],is_deadline:true,date_iso:'2020-12-31'},{...a.schedule[0],is_deadline:true,date_iso:'2020-01-01'}];
  assert.equal(mainDeadline(a)?.date_iso,'2020-12-31');
  assert.doesNotThrow(()=>buildIcs(a,null));
});
