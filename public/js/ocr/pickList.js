// 작업272-3: OCR 터치 모드의 선택 목록 로직(순수 함수, DOM 없음, import 없음). 모든 함수는 새 배열을 돌려주고 원본을 바꾸지 않는다.
// 같은 단어는 대소문자를 무시하고 한 번만 담고, 최대 MAX_PICKS 개까지 담는다.
export const MAX_PICKS = 20;

const keyOf = w => String(w).trim().toLowerCase();

export function hasPick(list, word) {
  const k = keyOf(word == null ? '' : word);
  return !!k && list.some(x => keyOf(x) === k);
}

// 반환: { list, status } — status: 'added' | 'duplicate'(이미 담김) | 'full'(상한) | 'invalid'(빈 단어)
export function addPick(list, word, max = MAX_PICKS) {
  const w = String(word == null ? '' : word).trim();
  if (!w) return { list, status: 'invalid' };
  if (hasPick(list, w)) return { list, status: 'duplicate' };
  if (list.length >= max) return { list, status: 'full' };
  return { list: [...list, w], status: 'added' };
}

// index 의 항목을 delta 칸(위 = -1, 아래 = +1) 옮긴다. 범위를 벗어나면 그대로
export function movePick(list, index, delta) {
  const to = index + delta;
  if (!Number.isInteger(index) || !Number.isInteger(delta) || delta === 0 || index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function removePick(list, index) {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}
