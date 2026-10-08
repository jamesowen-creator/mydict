// 작업212: 옛 회귀 스크립트 8개(tests/legacy/*.js)를 각각 node 자식 프로세스로 실행해 종료 코드 0과 "fail 0"을 확인한다.
// 스크립트 이름을 *.test.js로 하지 않은 이유: node --test "tests/**/*.test.js"가 스크립트를 직접 실행해 중복·오작동하는 것을 막기 위함.
// 파일마다 별도 테스트라 어느 파일이 실패했는지 바로 보인다. 실행: node --test "tests/**/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

// 이름: 기록해 둔 통과 개수(이보다 적으면 일부가 실행되지 않은 것). 개수는 작업212 시점의 값
const LEGACY = { admin193_2: 47, apitest: 52, body192_2: 10, imagetest: 120, linktest: 63, merge192: 54, quiz193_3: 48, stale191: 40 };
const ROOT = path.resolve(__dirname, '..', '..');

function run(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, file + '.js')], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill(), 110000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
  });
}

for (const [name, minPass] of Object.entries(LEGACY)) {
  test(`옛 회귀 ${name}: 종료 코드 0, "fail 0", 통과 ${minPass}개 이상`, { timeout: 120000 }, async () => {
    const { code, out } = await run(name);
    const m = [...out.matchAll(/\bpass (\d+) fail (\d+)\b/g)].pop();
    assert.ok(m, '결과 줄("pass N fail M")이 없음. 출력 끝: ' + out.split('\n').slice(-6).join('\n'));
    const fails = out.split('\n').filter(l => l.startsWith('FAIL'));
    assert.equal(Number(m[2]), 0, `fail ${m[2]}: ` + fails.slice(0, 5).join(' | '));
    assert.equal(code, 0, '종료 코드');
    assert.ok(Number(m[1]) >= minPass, `통과 ${m[1]}개 (기록: ${minPass}개 이상이어야 함)`);
  });
}
