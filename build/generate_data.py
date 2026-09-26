# -*- coding: utf-8 -*-
"""
从《词汇与词组精讲》与《逐字稿》两份 Markdown 生成学习网页所需的结构化数据。

设计原则：Markdown 是唯一数据源。只要视频产出了同样格式的两份文档，
本脚本即可为该视频生成一套学习网页，无需改动前端。

用法:
    python3 generate_data.py [--vocab A.md] [--transcript B.md] [--out ../data.js]
"""
import re
import os
import json
import argparse
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DEFAULT_VOCAB = os.path.join(os.path.dirname(PROJ), 'Naval_44_Harsh_Truths_词汇与词组精讲.md')
DEFAULT_TRANS = os.path.join(os.path.dirname(PROJ), 'Naval_44_Harsh_Truths_逐字稿.md')

THEME_MAP = {
    '心理 · 自我 · 情绪': ('psy', '心理 · 自我'),
    '财富 · 商业 · 职业': ('biz', '财富 · 商业'),
    '进化 · 生物 · 医学': ('bio', '进化 · 生物'),
    '社会 · 文化 · 政治': ('soc', '社会 · 文化'),
    '思维 · 认知 · 逻辑': ('cog', '思维 · 认知'),
    '哲学 · 人生': ('phi', '哲学 · 人生'),
    '其他高价值难词': ('misc', '其他难词'),
    '其他': ('misc', '其他难词'),
}

TIER_LABEL = {'core': '核心', 'mid': '进阶', 'rare': '拓展'}


# ---------------------------------------------------------------- 通用解析
def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def parse_sec(t):
    """'1:11:05' -> 4265"""
    parts = [int(x) for x in t.split(':')]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[0]


def fmt_sec(s):
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return f'{h}:{m:02d}:{sec:02d}' if h else f'{m:02d}:{sec:02d}'


def strip_md(s):
    """去掉 ** 与反引号，还原为纯文本"""
    s = s.strip()
    s = re.sub(r'\*\*(.+?)\*\*', r'\1', s)
    s = s.replace('`', '')
    s = s.replace('\\|', '|')
    return s.strip()


def split_h2(lines):
    order, secs, cur = [], {}, None
    for ln in lines:
        if ln.startswith('## ') and not ln.startswith('### '):
            cur = ln[3:].strip()
            secs[cur] = []
            order.append(cur)
        elif cur is not None:
            secs[cur].append(ln)
    return order, secs


def table_rows(block):
    """返回 (header, rows)，rows 为单元格列表"""
    header, rows = None, []
    for ln in block:
        s = ln.strip()
        if not (s.startswith('|') and s.endswith('|')):
            continue
        cells = [c.strip() for c in s.strip('|').split('|')]
        joined = ''.join(cells).replace('|', '')
        if joined and set(joined) <= set('-: '):
            continue
        if header is None:
            header = cells
            continue
        rows.append(cells)
    return header, rows


def search_key(disp):
    """把展示名转成可用于检索的键；无法检索时返回 None"""
    if ' / ' in disp:
        disp = disp.split(' / ')[0]
    if ' & ' in disp:
        disp = disp.split(' & ')[0]
    disp = disp.strip().strip('`')
    if not re.fullmatch(r"[A-Za-z][A-Za-z'\- ]*", disp):
        return None
    if len(disp) < 3:
        return None
    return disp


SUFFIX = r"(?:s|es|ed|d|ing|ly|ness|ment|ion|ions|al|ally|ity|ies|ied|er|est)?"
IRREGULAR = {
    'lay': ['lay', 'laid', 'lays', 'laying'],
    'lie': ['lie', 'lay', 'lies', 'lying'],
    'run': ['run', 'runs', 'ran', 'running'],
    'go': ['go', 'goes', 'went', 'going', 'gone'],
    'take': ['take', 'takes', 'took', 'taking', 'taken'],
    'come': ['come', 'comes', 'came', 'coming'],
    'get': ['get', 'gets', 'got', 'getting', 'gotten'],
    'give': ['give', 'gives', 'gave', 'giving', 'given'],
    'make': ['make', 'makes', 'made', 'making'],
    'pay': ['pay', 'pays', 'paid', 'paying'],
    'stick': ['stick', 'sticks', 'stuck', 'sticking'],
    'hang': ['hang', 'hangs', 'hung', 'hanging'],
    'hold': ['hold', 'holds', 'held', 'holding'],
    'keep': ['keep', 'keeps', 'kept', 'keeping'],
    'find': ['find', 'finds', 'found', 'finding'],
    'think': ['think', 'thinks', 'thought', 'thinking'],
    'bring': ['bring', 'brings', 'brought', 'bringing'],
    'break': ['break', 'breaks', 'broke', 'breaking', 'broken'],
    'blow': ['blow', 'blows', 'blew', 'blowing', 'blown'],
    'grow': ['grow', 'grows', 'grew', 'growing', 'grown'],
    'stand': ['stand', 'stands', 'stood', 'standing'],
    'fall': ['fall', 'falls', 'fell', 'falling', 'fallen'],
    'tell': ['tell', 'tells', 'told', 'telling'],
    'say': ['say', 'says', 'said', 'saying'],
    'see': ['see', 'sees', 'saw', 'seeing', 'seen'],
    'do': ['do', 'does', 'did', 'doing', 'done'],
    'have': ['have', 'has', 'had', 'having'],
    'sell': ['sell', 'sells', 'sold', 'selling'],
    'lead': ['lead', 'leads', 'led', 'leading'],
    'leave': ['leave', 'leaves', 'left', 'leaving'],
    'feel': ['feel', 'feels', 'felt', 'feeling'],
    'mean': ['mean', 'means', 'meant', 'meaning'],
    'lose': ['lose', 'loses', 'lost', 'losing'],
    'win': ['win', 'wins', 'won', 'winning'],
    'buy': ['buy', 'buys', 'bought', 'buying'],
    'seek': ['seek', 'seeks', 'sought', 'seeking'],
    'catch': ['catch', 'catches', 'caught', 'catching'],
    'teach': ['teach', 'teaches', 'taught', 'teaching'],
    'build': ['build', 'builds', 'built', 'building'],
    'spend': ['spend', 'spends', 'spent', 'spending'],
    'send': ['send', 'sends', 'sent', 'sending'],
    'read': ['read', 'reads', 'reading'],
    'draw': ['draw', 'draws', 'drew', 'drawing', 'drawn'],
    'swim': ['swim', 'swims', 'swam', 'swimming'],
    'rise': ['rise', 'rises', 'rose', 'rising', 'risen'],
    'scale': ['scale', 'scales', 'scaled', 'scaling'],
    'deal': ['deal', 'deals', 'dealt', 'dealing'],
    'shift': ['shift', 'shifts', 'shifted', 'shifting'],
}


def _esc(s):
    """转义，并让撇号成为可选（字幕常写作 prisoners dilemma）"""
    return re.escape(s).replace("'", "'?").replace('’', "'?")


def _token_regex(t):
    if t in IRREGULAR:
        alts = sorted(IRREGULAR[t], key=len, reverse=True)
        return '(?:' + '|'.join(_esc(a) for a in alts) + ')'
    alts = [t]
    if len(t) > 3 and t.endswith('es') and not t.endswith('ses'):
        alts.append(t[:-2])
    if len(t) > 3 and t.endswith('s') and not t.endswith('ss'):
        alts.append(t[:-1])
    alts = sorted(set(alts), key=len, reverse=True)
    return '(?:' + '|'.join(_esc(a) for a in alts) + ')' + SUFFIX


def infl_regex(key):
    """逐词允许屈折变形，多词短语亦可匹配（如 lay out -> laid out）；
    必须忽略大小写，否则句首大写的词会全部漏配。"""
    tokens = [t for t in re.split(r'\s+', key.lower()) if t]
    parts = [_token_regex(t) for t in tokens]
    return re.compile(r'(?<![a-z])' + r'[\s\-,]+'.join(parts) + r'(?![a-z])', re.IGNORECASE)


# ---------------------------------------------------------------- 逐字稿
def parse_transcript(path):
    raw = read(path)
    lines = raw.split('\n')

    meta = {'title': '', 'url': '', 'channel': '', 'guest': '', 'durationText': ''}
    for ln in lines[:30]:
        m = re.search(r'\*\*视频来源\*\*:\s*(\S+)', ln)
        if m:
            meta['url'] = m.group(1)
        m = re.search(r'\*\*频道\*\*:\s*(.+)', ln)
        if m:
            meta['channel'] = strip_md(m.group(1))
        m = re.search(r'\*\*嘉宾\*\*:\s*(.+)', ln)
        if m:
            meta['guest'] = strip_md(m.group(1))
        m = re.search(r'\*\*时长\*\*:\s*(.+)', ln)
        if m:
            meta['durationText'] = strip_md(m.group(1))
        m = re.search(r'^#\s+(.+)$', ln)
        if m and not meta['title']:
            meta['title'] = m.group(1).strip()
        m = re.search(r'\*\*Source:\*\*\s*(\S+)', ln)
        if m: meta['url'] = m.group(1)
        m = re.search(r'\*\*Creator:\*\*\s*(.+)', ln)
        if m: meta['channel'] = strip_md(m.group(1))
        m = re.search(r'\*\*Duration:\*\*\s*(.+)', ln)
        if m: meta['durationText'] = strip_md(m.group(1))

    # 只取「正文」之后的 ### 章节与句子
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith('## 正文'))
    except StopIteration:
        start = 0

    chapters, sentences = [], []
    cur = None
    re_ch = re.compile(r'^###\s+(.+?)\s*$')
    re_st = re.compile(r'^\*\s*章节起始\s*`?([\d:]+)`?\*?\s*$')
    re_st2 = re.compile(r'`(\d{1,2}:\d{2}(?::\d{2})?)`')
    re_sent = re.compile(r'^\*\*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\*\*\s+(.+?)\s*$')

    for ln in lines[start:]:
        m = re_ch.match(ln)
        if m:
            cur = {'title': m.group(1), 'sec': None, 'sentStart': len(sentences)}
            chapters.append(cur)
            continue
        if cur is not None and cur['sec'] is None:
            m = re_st.match(ln.strip())
            if not m:
                m = re_st2.search(ln) if ln.strip().startswith('*章节起始') else None
            if m:
                cur['sec'] = parse_sec(m.group(1))
                continue
        m = re_sent.match(ln)
        if m:
            sec = parse_sec(m.group(1))
            sentences.append([sec, m.group(2)])
            if cur is not None and cur['sec'] is None:
                cur['sec'] = sec

    # 章节区间
    for i, c in enumerate(chapters):
        c['endSec'] = chapters[i + 1]['sec'] if i + 1 < len(chapters) else 10 ** 9
        c['sentEnd'] = chapters[i + 1]['sentStart'] if i + 1 < len(chapters) else len(sentences)
        if c['sec'] is None:
            c['sec'] = sentences[c['sentStart']][0] if c['sentStart'] < len(sentences) else 0
    if sentences and not chapters:
        chapters = [{'title': meta['title'] or '正文', 'sec': sentences[0][0],
                     'endSec': 10 ** 9, 'sentStart': 0, 'sentEnd': len(sentences)}]

    # 勘误表（文末）
    errata = []
    tail = lines[start:]
    for i, ln in enumerate(tail):
        if '勘误' in ln and ln.startswith('#'):
            _, rows = table_rows(tail[i:])
            for r in rows:
                if len(r) >= 3:
                    errata.append({'asr': strip_md(r[0]), 'real': strip_md(r[1]), 'note': strip_md(r[2])})
            break

    # 句子时长：以下一句起点为界，并给出估算上限
    for i, s in enumerate(sentences):
        nxt = sentences[i + 1][0] if i + 1 < len(sentences) else s[0] + 8
        wc = len(s[1].split())
        est = max(2.0, wc / 215 * 60)
        end = min(nxt, s[0] + max(est * 1.6, est + 1.5))
        if end <= s[0]:
            end = s[0] + est
        s.append(round(end, 1))

    return meta, chapters, sentences, errata


# ---------------------------------------------------------------- 词汇文档
def parse_vocab(path):
    lines = read(path).split('\n')
    order, secs = split_h2(lines)

    def find(prefix):
        for k in order:
            if k.startswith(prefix):
                return secs[k]
        return []

    out = {
        'words': [], 'phrases': [], 'concepts': [], 'idioms': [],
        'starter': [], 'start40': [], 'markers': [], 'reductions': [], 'errata': [],
        'speed': [], 'plan': [], 'appendix': [], 'method': [], 'overview': [],
    }

    # ---- 一、结论速览
    out['overview'] = [strip_md(l[2:].strip()) for l in find('一、') if l.strip().startswith('> ')]

    # ---- 二、分析口径
    for l in find('二、'):
        s = l.strip()
        if s.startswith('### '):
            out['method'].append({'h': strip_md(s[4:]), 'items': []})
        elif s.startswith('- ') and out['method']:
            out['method'][-1]['items'].append(strip_md(s[2:]))
        elif s.startswith('> ') and out['method']:
            out['method'][-1]['items'].append(strip_md(s[2:]))
        elif s and not s.startswith('|') and not s.startswith('#') and out['method'] and not out['method'][-1]['items']:
            out['method'][-1].setdefault('intro', strip_md(s))

    def add_word(cells, tier, theme_key, theme_label, with_first):
        # 词 | 音标 | 词性 | 中文/在视频中的意思 | 次数 | 首现
        name = strip_md(cells[0])
        if not name:
            return
        phone = strip_md(cells[1]) if len(cells) > 1 else ''
        pos = strip_md(cells[2]) if len(cells) > 2 else ''
        cn = strip_md(cells[3]) if len(cells) > 3 else ''
        n = 0
        first = None
        if with_first:
            # 3.2：词|音标|词性|意思|次数|首现
            if len(cells) >= 6:
                n = int(re.sub(r'\D', '', cells[4]) or 0)
                m = re.search(r'(\d{1,2}:\d{2}(?::\d{2})?)', cells[5])
                first = parse_sec(m.group(1)) if m else None
        else:
            # 四/五：词|音标|词性|中文|主题   （次数由 tier 决定，首现稍后计算）
            n = {'core': 3, 'mid': 2, 'rare': 1}.get(tier, 1)
        out['words'].append({
            'disp': name, 'phone': phone, 'pos': pos, 'cn': cn, 'n': n,
            'first': first, 'tier': tier, 'theme': theme_key, 'themeLabel': theme_label,
            'note': '', 'starter': False,
        })

    # ---- 3.1 首轮 40 词
    b31 = find('三、')
    idx31 = next((i for i, l in enumerate(b31) if l.startswith('### 3.1')), None)
    idx32 = next((i for i, l in enumerate(b31) if l.startswith('### 3.2')), None)
    if idx31 is not None:
        _, rows = table_rows(b31[idx31:idx32 or len(b31)])
        for r in rows:
            if len(r) >= 4:
                name = strip_md(r[1])
                if name:
                    out['starter'].append(name)
                    out['start40'].append({
                        'disp': name,
                        'phone': strip_md(r[2]) if len(r) > 2 else '',
                        'cn': strip_md(r[3]) if len(r) > 3 else '',
                        'n': int(re.sub(r'\D', '', r[4]) or 0) if len(r) > 4 else 0,
                    })

    # ---- 3.2 核心词全表（按 #### 主题分组）
    if idx32 is not None:
        block = b31[idx32 + 1:]   # 跳过 "### 3.2 …" 标题行本身
        group_key, group_label = 'misc', '其他难词'
        buf, cur_group = [], None
        for ln in block:
            if ln.startswith('#### '):
                if buf:
                    _, rows = table_rows(buf)
                    for r in rows:
                        if len(r) >= 5:
                            add_word(r, 'core', group_key, group_label, with_first=True)
                    buf = []
                gname = strip_md(ln[5:])
                group_key, group_label = THEME_MAP.get(gname, ('misc', gname))
            elif ln.startswith('### '):
                if buf:
                    _, rows = table_rows(buf)
                    for r in rows:
                        if len(r) >= 5:
                            add_word(r, 'core', group_key, group_label, with_first=True)
                    buf = []
                break
            else:
                buf.append(ln)
        if buf:
            _, rows = table_rows(buf)
            for r in rows:
                if len(r) >= 5:
                    add_word(r, 'core', group_key, group_label, with_first=True)

    # ---- 四、进阶（2 次）与 五、拓展（1 次）
    for pref, tier in (('四、', 'mid'), ('五、', 'rare')):
        _, rows = table_rows(find(pref))
        for r in rows:
            if len(r) >= 5:
                th = strip_md(r[4])
                k, lab = THEME_MAP.get(th, ('misc', th))
                add_word(r, tier, k, lab, with_first=False)

    # 去重（3.2 已含部分 3.1 词）
    seen, uniq = set(), []
    for w in out['words']:
        key = w['disp'].lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(w)
    out['words'] = uniq

    # Generic item format: H2 term headings with labeled definition/example fields.
    if not out['words'] and not out['phrases']:
        current = None
        for ln in lines:
            m = re.match(r'^##\s+(.+?)\s*$', ln)
            if m:
                current = {'disp': strip_md(m.group(1)), 'pos': '', 'cn': '', 'ex': '', 'note': ''}
                continue
            if current is None:
                continue
            m = re.match(r'^-\s*(词性|中文|原句|用法)：\s*(.*)$', ln.strip())
            if m:
                current[{'词性':'pos','中文':'cn','原句':'ex','用法':'note'}[m.group(1)]] = strip_md(m.group(2))
                if m.group(1) == '用法':
                    is_phrase = current['pos'].lower().startswith('phr') or ' ' in current['disp']
                    target = out['phrases'] if is_phrase else out['words']
                    target.append({'disp':current['disp'], 'phone':'', 'pos':current['pos'], 'cn':current['cn'],
                                   'n':1, 'first':None, 'tier':'rare', 'theme':'misc', 'themeLabel':'表达',
                                   'note':current['note'], 'starter':False, 'ex':current['ex'], 'exSec':None})
                    current = None

    # ---- 六、短语与固定搭配
    _, rows = table_rows(find('六、'))
    for r in rows:
        if len(r) < 4:
            continue
        disp = strip_md(r[0])
        n = int(re.sub(r'\D', '', strip_md(r[1])) or 0)
        cn = strip_md(r[2])
        ex_cell = r[3]
        m = re.search(r'(\d{1,2}:\d{2}(?::\d{2})?)', ex_cell)
        ex_sec = parse_sec(m.group(1)) if m else None
        ex = strip_md(ex_cell)
        if m:
            ex = ex.replace(m.group(1), '', 1).strip()
        out['phrases'].append({'disp': disp, 'n': n, 'cn': cn, 'exSec': ex_sec, 'ex': ex})

    # ---- 七、概念术语
    _, rows = table_rows(find('七、'))
    for r in rows:
        if len(r) < 3:
            continue
        out['concepts'].append({
            'disp': strip_md(r[0]),
            'n': int(re.sub(r'\D', '', strip_md(r[1])) or 0),
            'desc': strip_md(r[2]),
        })

    # ---- 八、习语与典故
    b8 = find('八、')
    cur = None
    for ln in b8:
        m = re.match(r"^\*\*`(.+?)`\*\*\s*$", ln.strip())
        if m:
            cur = {'disp': m.group(1).strip(), 'cn': '', 'exSec': None, 'ex': ''}
            out['idioms'].append(cur)
            continue
        if cur is None:
            continue
        m = re.match(r'^-\s*\*\*含义\*\*[：:]\s*(.+)$', ln.strip())
        if m:
            cur['cn'] = strip_md(m.group(1))
            continue
        m = re.match(r'^-\s*\*\*视频原句\*\*[：:]\s*(.+)$', ln.strip())
        if m:
            body = m.group(1).strip()
            mm = re.search(r'(\d{1,2}:\d{2}(?::\d{2})?)', body)
            if mm:
                cur['exSec'] = parse_sec(mm.group(1))
                body = body.replace(mm.group(1), '', 1).strip()
            cur['ex'] = strip_md(body)
            continue

    # ---- 九、听力
    b9 = find('九、')
    i91 = next((i for i, l in enumerate(b9) if l.startswith('### 9.1')), None)
    i92 = next((i for i, l in enumerate(b9) if l.startswith('### 9.2')), None)
    i93 = next((i for i, l in enumerate(b9) if l.startswith('### 9.3')), None)
    i94 = next((i for i, l in enumerate(b9) if l.startswith('### 9.4')), None)

    if i91 is not None:
        _, rows = table_rows(b9[i91:i92])
        for r in rows:
            if len(r) >= 3:
                out['markers'].append({'name': strip_md(r[0]), 'n': int(re.sub(r'\D', '', strip_md(r[1])) or 0), 'note': strip_md(r[2])})
    if i92 is not None:
        _, rows = table_rows(b9[i92:i93])
        for r in rows:
            if len(r) >= 3:
                out['reductions'].append({'written': strip_md(r[0]), 'ipa': strip_md(r[1]), 'note': strip_md(r[2])})
        for ln in b9[i92:i93]:
            if ln.strip().startswith('> '):
                out['reductions'].append({'written': '', 'ipa': '', 'note': strip_md(ln.strip()[2:]), 'quote': True})
    if i93 is not None:
        _, rows = table_rows(b9[i93:i94])
        for r in rows:
            if len(r) >= 3:
                out['errata'].append({'asr': strip_md(r[0]), 'real': strip_md(r[1]), 'note': strip_md(r[2])})
    if i94 is not None:
        for ln in b9[i94:]:
            s = ln.strip()
            if s.startswith('- '):
                out['speed'].append(strip_md(s[2:]))
            elif s.startswith('#') or s.startswith('---'):
                break
            elif s.startswith('> '):
                out['speed'].append(strip_md(s[2:]))

    # ---- 十、学习计划
    b10 = find('十、')
    _, rows = table_rows(b10)
    for r in rows:
        if len(r) >= 3:
            out['plan'].append({'stage': strip_md(r[0]), 'task': strip_md(r[1]), 'check': strip_md(r[2])})

    # ---- 十一、附录
    _, rows = table_rows(find('十一、'))
    for r in rows:
        if len(r) >= 2:
            out['appendix'].append({'expr': strip_md(r[0]), 'why': strip_md(r[1])})

    return out


# ---------------------------------------------------------------- 例句索引
def build_index(sentences, entries, key_of, sec_of):
    """为每个条目补 first / 例句；返回逐句的命中实体表"""
    pats = []
    for i, e in enumerate(entries):
        k = key_of(e)
        pats.append(infl_regex(k) if k else None)

    per_sent = [[] for _ in sentences]
    for i, e in enumerate(entries):
        p = pats[i]
        if p is None:
            continue
        hits = []
        for si, s in enumerate(sentences):
            if p.search(s[1]):
                per_sent[si].append(i)
                hits.append(si)
        e['occ'] = len(hits)
        if hits and sec_of(e) is None:
            e['first'] = sentences[hits[0]][0]
        # 文档已提供人工校验过的例句则保留，否则自动挑选
        if not e.get('ex'):
            best, bestd = None, 1e9
            for si in hits:
                txt = sentences[si][1]
                if not (45 <= len(txt) <= 265):
                    continue
                if p.search(txt[:14]):
                    continue
                d = abs(len(txt) - 125)
                if d < bestd:
                    best, bestd = si, d
            if best is None and hits:
                best = hits[0]
            if best is not None:
                e['exSec'] = sentences[best][0]
                e['ex'] = sentences[best][1][:200]
        # 正文中检索不到时，退回到文档已给出的人工例句时间戳
        if e.get('first') is None and e.get('exSec') is not None:
            e['first'] = e['exSec']

    # 同一句内保留互不重叠的匹配，且优先保留更长者；输出精确字符区间
    # 注意：必须用 finditer 收集**全部**出现位置——同一句里重复出现的词条
    # （如 "They come in the moment, they leave in the moment."）只取首处会导致第二处漏高亮
    out = []
    for si, lst in enumerate(per_sent):
        if not lst:
            out.append([])
            continue
        txt = sentences[si][1]
        items = []
        for i in lst:
            for m in pats[i].finditer(txt):
                items.append((m.start(), m.end(), i))
        items.sort(key=lambda x: (x[0], -(x[1] - x[0])))
        keep, last = [], -1
        for st, en, i in items:
            if st >= last:
                keep.append([i, st, en])
                last = en
        out.append(keep)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vocab', default=DEFAULT_VOCAB)
    ap.add_argument('--transcript', default=DEFAULT_TRANS)
    ap.add_argument('--out', default=os.path.join(PROJ, 'data.js'))
    args = ap.parse_args()

    tmeta, chapters, sentences, errata = parse_transcript(args.transcript)
    V = parse_vocab(args.vocab)

    words = V['words']
    phrases = V['phrases']
    concepts = V['concepts']

    # 统一实体表（用于高亮与检索）
    starter_set = {s.lower() for s in V['starter']}
    for w in words:
        w['starter'] = w['disp'].lower() in starter_set

    entities = []
    for w in words:
        entities.append({
            'type': 'word', 'disp': w['disp'], 'key': search_key(w['disp']),
            'phone': w['phone'], 'pos': w['pos'], 'cn': w['cn'], 'n': w['n'],
            'tier': w['tier'], 'theme': w['theme'], 'themeLabel': w['themeLabel'],
            'starter': w['starter'],
        })
    for p in phrases:
        entities.append({
            'type': 'phrase', 'disp': p['disp'], 'key': search_key(p['disp']),
            'phone': '', 'pos': '', 'cn': p['cn'], 'n': p['n'],
            'tier': 'phrase', 'theme': 'phr', 'themeLabel': '短语搭配',
            'starter': False, 'exSec': p['exSec'], 'ex': p['ex'],
        })
    for c in concepts:
        entities.append({
            'type': 'concept', 'disp': c['disp'], 'key': search_key(c['disp']),
            'phone': '', 'pos': '', 'cn': c['desc'], 'n': c['n'],
            'tier': 'concept', 'theme': 'con', 'themeLabel': '概念术语',
            'starter': False,
        })

    # §3.1 首轮 40 词中未被主词表收录的（如 desire / suffering / fame / attention / status）
    # 这些词被基线过滤器判为「已掌握」，但承载本片核心命题，必须补齐
    have = {(e['key'] or e['disp']).lower() for e in entities}
    for s in V['start40']:
        k = re.split(r'\s*[/&]\s*', s['disp'])[0].strip().lower()
        if k in have:
            continue
        have.add(k)
        entities.append({
            'type': 'word', 'disp': s['disp'], 'key': s['disp'].lower(),
            'phone': s['phone'], 'pos': '', 'cn': s['cn'], 'n': s['n'],
            'tier': 'core', 'theme': 'start', 'themeLabel': '首轮 40 词',
            'starter': True,
        })

    for i, e in enumerate(entities):
        e.setdefault('exSec', None)
        e.setdefault('ex', '')
        # 首轮 40 词同样覆盖短语与概念类词条（如 free will、loss aversion、desire & suffering）
        key0 = re.split(r'\s*[/&]\s*', e['disp'])[0].strip().lower()
        if key0 in starter_set:
            e['starter'] = True

    # 同名词条合并：词 > 短语 > 概念，概念说明并入词条，避免重复高亮
    merged, pos_of_key = [], {}
    for e in entities:
        k = (e['key'] or e['disp']).lower()
        if k in pos_of_key:
            prev = merged[pos_of_key[k]]
            if prev['type'] == 'concept' and e['type'] != 'concept':
                e['conceptDesc'] = prev['cn']
                e['conceptN'] = prev['n']
                merged[pos_of_key[k]] = e
            elif e['type'] == 'concept':
                prev['conceptDesc'] = e['cn']
                prev['conceptN'] = e['n']
            continue
        pos_of_key[k] = len(merged)
        merged.append(e)
    entities = merged

    for i, e in enumerate(entities):
        e['id'] = i

    per_sent = build_index(sentences, entities, lambda e: e['key'], lambda e: e.get('first'))

    # 概念与同名词条合并展示（避免重复高亮）
    for c in concepts:
        k = c['disp'].lower().split(' / ')[0].strip()
        for e in entities:
            if e['type'] == 'word' and e['disp'].lower() == k:
                c['wordId'] = e['id']
                break

    # 预计算每章涉及的词条（供右侧生词面板使用）
    n_ent = len(entities)
    for ch in chapters:
        seen = set()
        for si in range(ch['sentStart'], min(ch['sentEnd'], len(per_sent))):
            for m in per_sent[si]:
                seen.add(m[0])
        ch['entities'] = sorted(seen, key=lambda i: (-entities[i]['n'], entities[i]['disp'].lower()))

    # 条目里回填 first，供前端使用
    for e in entities:
        e['first'] = e.get('first')
        e['occ'] = e.get('occ', 0)

    vid = ''
    m = re.search(r'[?&]v=([\w-]{6,})', tmeta.get('url', ''))
    if m:
        vid = m.group(1)

    data = {
        'meta': {
            'title': tmeta['title'] or 'Video study guide',
            'url': tmeta.get('url', ''),
            'videoId': vid,
            'channel': tmeta.get('channel', ''),
            'guest': tmeta.get('guest', ''),
            'durationText': tmeta.get('durationText', ''),
            'sentenceCount': len(sentences),
            'chapterCount': len(chapters),
            'wordCount': len(words),
            'phraseCount': len(phrases),
            'conceptCount': len(concepts),
            'idiomCount': len(V['idioms']),
            'builtAt': datetime.datetime.now().strftime('%Y-%m-%d'),
        },
        'overview': V['overview'],
        'method': V['method'],
        'chapters': chapters,
        'sentences': sentences,
        'matches': per_sent,
        'entities': entities,
        'concepts': concepts,
        'idioms': V['idioms'],
        'listening': {
            'markers': V['markers'], 'reductions': V['reductions'],
            'errata': errata or V['errata'], 'speed': V['speed'],
        },
        'plan': V['plan'],
        'appendix': V['appendix'],
    }

    payload = 'window.NAVAL_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(payload)

    matched = sum(1 for e in entities if e.get('first') is not None)
    print(f"句子 {len(sentences)} ｜ 章节 {len(chapters)}")
    print(f"实体 {len(entities)}（词 {len(words)} / 短语 {len(phrases)} / 概念 {len(concepts)}）")
    print(f"定位到时间戳 {matched} / {len(entities)}")
    print(f"习语 {len(V['idioms'])} ｜ 标记词 {len(V['markers'])} ｜ 弱读 {len(V['reductions'])} ｜ 勘误 {len(data['listening']['errata'])}")
    print(f"输出 {args.out}  {os.path.getsize(args.out)/1024:.0f} KB")

    miss = [e['disp'] for e in entities if e.get('first') is None]
    if miss:
        print('未定位:', miss[:20])


if __name__ == '__main__':
    main()
