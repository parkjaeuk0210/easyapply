import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactParts } from '../src/lib/contact';

test('contact links preserve the full source text and support phone and email actions', () => {
  const text = '청년정책과 ☎ 033-250-1234 / 02-1234-5678 / 1588-1234\n문의: youth+apply@example.go.kr (평일 09:00~18:00)';
  const parts = contactParts(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.flatMap(part => part.href ? [part.href] : []), [
    'tel:0332501234', 'tel:0212345678', 'tel:15881234', 'mailto:youth%2Bapply@example.go.kr',
  ]);
});

test('contact parsing avoids dates and escapes email URI input while leaving markup as text', () => {
  const text = '<script>alert(1)</script> 접수 2026-11-06, 우편번호 24341, 메일 user%0d%0a@example.com';
  const parts = contactParts(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), ['mailto:user%250d%250a@example.com']);
  assert(parts.every(part => !part.href || /^(tel:|mailto:)/.test(part.href)));
});

test('international Korean phone numbers and plain text remain usable without invented contacts', () => {
  assert.deepEqual(contactParts('전화 +82-33-250-1234').filter(part => part.href), [
    { text: '+82-33-250-1234', href: 'tel:+82332501234' },
  ]);
  assert.deepEqual(contactParts('담당 부서에 문의해 주세요.'), [{ text: '담당 부서에 문의해 주세요.' }]);
  assert.deepEqual(contactParts(''), []);
});
