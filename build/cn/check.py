import re, sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
src = {}
for ln in open(BASE / 'build/sentences.tsv', encoding='utf-8'):
    ln = ln.rstrip('\n')
    if not ln.strip():
        continue
    a, b = ln.split('\t', 1)
    src[int(a)] = b

def load(path):
    out = []
    for l in open(path, encoding='utf-8-sig'):
        l = l.rstrip('\n')
        if not l.strip():
            continue
        m = re.match(r'^(\d+)[\t 　]+(.*)$', l)
        out.append((int(m.group(1)), m.group(2)))
    return out

if __name__ == '__main__':
    path, start = sys.argv[1], int(sys.argv[2])
    mine = load(path)
    print('lines:', len(mine), 'first:', mine[0][0], 'last:', mine[-1][0])
    for k, (lab, t) in enumerate(mine):
        s = src.get(start + k, '<NO SRC>')
        print(f'{k:3d} L{lab} {t[:34]:<36}|| S{start+k} {s[:44]}')
