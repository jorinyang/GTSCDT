# -*- coding: utf-8 -*-
"""fenglin-camp FC Web 函数（WSGI）：课堂 API，状态与文件存 OSS"""
import os, json, base64, hmac, hashlib, time, urllib.parse
from urllib.parse import quote
import urllib.request, urllib.error

AK = os.environ.get('OSS_AK', '')
SK = os.environ.get('OSS_SK', '')
ENDPOINT = os.environ.get('OSS_ENDPOINT', 'oss-cn-hangzhou.aliyuncs.com')
BUCKET = os.environ.get('OSS_BUCKET', 'YOUR-BUCKET')
PREFIX = 'web-spa/course-kit/data/'
STATE_KEY = PREFIX + 'state.json'
GROUPS = list('ABCDEFG')
LAST_ERR = ''
_CURRENT_STATE = None

def _oss(method, key, body=None, ctype='application/json'):
    date = time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime())
    resource = '/' + BUCKET + '/' + key
    sts = method + '\n\n' + (ctype if body is not None else '') + '\n' + date + '\n' + resource
    sig = base64.b64encode(hmac.new(SK.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    url = 'https://%s.%s/%s' % (BUCKET, ENDPOINT, quote(key, safe='/'))
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('Date', date)
    req.add_header('Authorization', 'OSS %s:%s' % (AK, sig))
    if body is not None:
        req.add_header('Content-Type', ctype)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        global LAST_ERR
        LAST_ERR = type(e).__name__ + ': ' + str(e)[:300]
        return -1, b''

def blank():
    return {'students': {}, 'groups': {g: {'name': g + '组', 'perf': 0} for g in GROUPS},
            'poll': {'active': False, 'question': '', 'options': [], 'votes': {}, 'startedAt': ''},
            'submissions': {}, 'config': {'hwOpen': False, 'workshopOpen': False, 'groupMax': 3, 'model': {'baseUrl': 'https://api.deepseek.com', 'model': 'deepseek-flash', 'apiKey': ''}}, 'buzz': {'enabled': False, 'running': False, 'winner': '', 'round': 0, 'at': ''}, 'quiz': {'bank': {'choice': [], 'judge': [], 'blank': [], 'short': []}, 'config': {'mode': 'random', 'counts': {'choice': 5, 'judge': 3, 'blank': 2, 'short': 1}, 'scores': {'choice': 2, 'judge': 2, 'blank': 3, 'short': 10}}, 'paper': None, 'answers': {}}, 'updatedAt': ''}

def load():
    global _CURRENT_STATE
    st, b = _oss('GET', STATE_KEY)
    if st != 200:
        _CURRENT_STATE = blank(); return _CURRENT_STATE
    try:
        s = json.loads(b.decode('utf-8')); base = blank(); base.update(s); _CURRENT_STATE = base; return base
    except Exception:
        _CURRENT_STATE = blank(); return _CURRENT_STATE

def save(s):
    s['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    _oss('PUT', STATE_KEY, json.dumps(s, ensure_ascii=False).encode('utf-8'))

def key_of(name, tail):
    return str(name).strip() + '|' + str(tail).strip()

def ensure_student(s, name, tail):
    k = key_of(name, tail)
    if k not in s['students']:
        s['students'][k] = {'name': str(name).strip(), 'tail': str(tail).strip(), 'group': '', 'score': 0, 'votes': 0, 'buzzes': 0,
                            'joinedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    return s['students'][k]

def counts(s):
    c = {g: 0 for g in s['groups']}
    for st in s['students'].values():
        if st.get('group') in c:
            c[st['group']] += 1
    return c


def _q_tok(x):
    return [ch for ch in str(x or '').lower() if ch.isalnum() or '一' <= ch <= '鿿']

def _q_sim(a, b):
    A = _q_tok(a); B = _q_tok(b)
    if not A or not B:
        return 0.0
    from collections import Counter
    ca, cb = Counter(A), Counter(B)
    return sum(min(ca[c], cb[c]) for c in cb) / max(len(A), len(B))

def _q_grade(q, ans):
    t = q.get('type')
    if t == 'choice':
        return 1 if str(ans or '').upper() == str(q.get('answer', '')).upper() else 0
    if t in ('judge', 'blank'):
        return 1 if str(ans or '').strip() == str(q.get('answer', '')).strip() else 0
    return round(_q_sim(ans, q.get('ref', '')), 2)


def _model_cfg(s):
    c = ((s.get('config') or {}).get('model') or {})
    return {'base': (c.get('baseUrl') or os.environ.get('DEEPSEEK_BASE') or 'https://api.deepseek.com').rstrip('/'),
            'model': c.get('model') or os.environ.get('DEEPSEEK_MODEL') or 'deepseek-flash',
            'key': c.get('apiKey') or os.environ.get('DEEPSEEK_API_KEY') or ''}

def _model_chat(s, messages, max_tokens=600):
    cfg = _model_cfg(s)
    if not cfg['key']:
        return {'ok': False, 'error': '未配置 API Key'}
    body = json.dumps({'model': cfg['model'], 'messages': messages, 'temperature': 0, 'max_tokens': max_tokens}).encode('utf-8')
    req = urllib.request.Request(cfg['base'] + '/chat/completions', data=body,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg['key']})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            j = json.loads(r.read().decode('utf-8'))
        return {'ok': True, 'content': j['choices'][0]['message']['content'], 'model': cfg['model'], 'ms': int((time.time() - t0) * 1000)}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:160]}

def _q_model(q, ans):
    prompt = ('你是课堂评分助教。判断学员答案与参考答案的匹配程度，只输出 0-100 的整数，不要解释。'
              + '题目：' + str(q.get('q', '')) + '；参考答案：' + str(q.get('ref', '')) + '；学员答案：' + str(ans or '（未作答）'))
    r = _model_chat(_CURRENT_STATE, [{'role': 'user', 'content': prompt}], 600)
    if not r.get('ok'):
        return None
    import re
    m = re.search(r'[0-9]+', str(r.get('content', '')))
    return max(0, min(100, int(m.group(0)))) if m else None

def _q_model_OLD(q, ans):
    key = os.environ.get('DEEPSEEK_API_KEY', '')
    if not key:
        return None
    base = os.environ.get('DEEPSEEK_BASE', 'https://api.deepseek.com').rstrip('/')
    model = os.environ.get('DEEPSEEK_MODEL', 'deepseek-flash')
    prompt = ('你是课堂评分助教。判断学员答案与参考答案的匹配程度，只输出 0-100 的整数，不要解释。'
              + '题目：' + str(q.get('q', '')) + '；参考答案：' + str(q.get('ref', '')) + '；学员答案：' + str(ans or '（未作答）'))
    body = json.dumps({'model': model, 'messages': [{'role': 'user', 'content': prompt}], 'temperature': 0}).encode('utf-8')
    req = urllib.request.Request(base + '/chat/completions', data=body,
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.loads(r.read().decode('utf-8'))
        import re
        txt = j['choices'][0]['message']['content']
        m = re.search(r'[0-9]+', txt)
        return max(0, min(100, int(m.group(0)))) if m else None
    except Exception:
        return None

def _student_quiz(s, k):
    q = s.get('quiz') or {}
    p = q.get('paper')
    if not p or not p.get('active'):
        return {'active': False}
    a = (q.get('answers') or {}).get(k)
    return {'active': True, 'submitted': a is not None, 'myScore': (a or {}).get('score'),
            'total': sum((x.get('score') or 0) for x in p['questions']),
            'questions': [{'id': x['id'], 'type': x.get('type'), 'q': x['q'],
                           'options': x.get('options') or [], 'score': x.get('score', 0)} for x in p['questions']]}

def student_view(s, k):
    me = s['students'].get(k); p = s['poll']; voted = p.get('votes', {}).get(k) is not None
    group_perf = 0; group_score = 0
    if me and me.get('group'):
        g = me['group']
        group_perf = (s['groups'].get(g) or {}).get('perf', 0)
        gsub = sum(((v.get('score') or {}).get('total', 0) or 0) for kk, v in s['submissions'].items()
                   if (s['students'].get(kk.split('||')[0]) or {}).get('group') == g)
        group_score = group_perf + gsub
    subs = [{'task': key.split('||')[1], 'at': v.get('at', ''), 'total': (v.get('score') or {}).get('total', 0),
             'files': len(v.get('files') or [])} for key, v in s['submissions'].items() if key.startswith(k + '||')]
    return {'ok': True,
            'me': {'name': me['name'], 'tail': me['tail'], 'group': me.get('group', ''), 'score': group_score,
                   'groupPerf': group_perf, 'groupScore': group_score} if me else None,
            'poll': {'active': True, 'question': p.get('question', ''), 'options': p.get('options', []),
                     'voted': voted, 'myVote': p.get('votes', {}).get(k) if voted else None,
                     'startedAt': p.get('startedAt', '')} if p.get('active') else {'active': False},
            'hwOpen': bool((s.get('config') or {}).get('hwOpen')),
            'workshopOpen': bool((s.get('config') or {}).get('workshopOpen')),
            'buzz': {'enabled': bool((s.get('buzz') or {}).get('enabled')), 'running': bool((s.get('buzz') or {}).get('running')), 'winner': (s.get('buzz') or {}).get('winner', ''), 'round': (s.get('buzz') or {}).get('round', 0)},
            'quiz': _student_quiz(s, k),
            'groupCounts': counts(s), 'groups': [{'id': g, 'name': s['groups'][g]['name']} for g in s['groups']],
            'submissions': subs}

def admin_view(s):
    _qz = s.get('quiz') or {}
    _qbank = {t: len((_qz.get('bank') or {}).get(t) or []) for t in ['choice', 'judge', 'blank', 'short']}
    _qans = list((_qz.get('answers') or {}).values())
    quiz_info = {'bank': _qbank, 'config': _qz.get('config') or {},
                 'paper': ({'active': bool((_qz.get('paper') or {}).get('active')), 'at': (_qz.get('paper') or {}).get('at'),
                            'count': len((_qz.get('paper') or {}).get('questions') or []),
                            'points': sum((x.get('score') or 0) for x in ((_qz.get('paper') or {}).get('questions') or []))}
                           if _qz.get('paper') else None),
                 'answered': len(_qans), 'avg': (round(sum((x.get('score') or 0) for x in _qans) / len(_qans), 1) if _qans else 0)}
    results = {i: 0 for i in range(len(s['poll'].get('options') or []))}
    for v in (s['poll'].get('votes') or {}).values():
        if v in results:
            results[v] += 1
    subs = []
    for key, v in s['submissions'].items():
        parts = key.split('||'); st = s['students'].get(parts[0], {})
        subs.append({'key': key, 'studentKey': parts[0], 'name': st.get('name', parts[0]), 'tail': st.get('tail', ''),
                     'task': parts[1], 'text': v.get('text', ''), 'q1': v.get('q1', ''), 'q2': v.get('q2', ''),
                     'q3': v.get('q3', ''), 'files': v.get('files') or [], 'at': v.get('at', ''),
                     'manual': v.get('manual') or [], 'score': v.get('score')})
    return {'ok': True, 'students': [dict({'key': k}, **v) for k, v in s['students'].items()],
            'groups': [{'id': g, 'name': s['groups'][g]['name'], 'perf': s['groups'][g].get('perf', 0),
                        'count': counts(s)[g]} for g in s['groups']],
            'counts': counts(s),
            'quiz': quiz_info,
            'model': {'baseUrl': _model_cfg(s)['base'], 'model': _model_cfg(s)['model'], 'hasKey': bool(_model_cfg(s)['key'])},
            'config': s.get('config') or {}, 'buzz': s.get('buzz') or {},
            'poll': {'active': s['poll'].get('active'), 'question': s['poll'].get('question', ''),
                     'options': s['poll'].get('options', []), 'votes': s['poll'].get('votes', {}),
                     'results': results, 'startedAt': s['poll'].get('startedAt', '')},
            'submissions': subs, 'updatedAt': s.get('updatedAt', '')}

def dispatch(method, path, q, raw):
    if method == 'OPTIONS':
        return 200, {}, b''
    if path == '/api/debug':
        return 200, {'Content-Type': 'application/json; charset=utf-8'}, json.dumps({'last': LAST_ERR, 'ak': bool(AK), 'sk': bool(SK), 'endpoint': ENDPOINT, 'bucket': BUCKET}, ensure_ascii=False).encode()
    if path == '/api/ping':
        return 200, {'Content-Type': 'application/json; charset=utf-8'}, json.dumps({'ok': True, 'fc': True, 'ts': int(time.time() * 1000)}).encode()
    s = load()
    if path == '/api/state':
        name, tail = q.get('name', [''])[0], q.get('tail', [''])[0]
        if not name or not tail:
            return 400, {}, json.dumps({'ok': False, 'error': 'need name+tail'}).encode()
        ensure_student(s, name, tail); save(s)
        return 200, {'Content-Type': 'application/json; charset=utf-8'}, json.dumps(student_view(s, key_of(name, tail)), ensure_ascii=False).encode()
    if path == '/api/admin/state':
        return 200, {'Content-Type': 'application/json; charset=utf-8'}, json.dumps(admin_view(s), ensure_ascii=False).encode()
    if path == '/api/file':
        k = q.get('key', [''])[0]; task = q.get('task', [''])[0]
        try:
            idx = int(q.get('i', ['0'])[0])
        except Exception:
            idx = 0
        sub = s['submissions'].get(k + '||' + task); files = (sub or {}).get('files') or []
        if not sub or idx >= len(files):
            return 404, {}, b'not found'
        st, b = _oss('GET', files[idx]['path'])
        return (200, {'Content-Type': 'application/octet-stream'}, b) if st == 200 else (404, {}, b'not found')
    if method == 'POST':
        b = {}
        if path != '/api/upload':
            try:
                b = json.loads(raw.decode('utf-8')) if raw else {}
            except Exception:
                b = {}
        if path == '/api/join':
            ensure_student(s, b.get('name', ''), b.get('tail', '')); save(s)
            return 200, {'Content-Type': 'application/json; charset=utf-8'}, json.dumps({'ok': True}, ensure_ascii=False).encode()
        if path == '/api/draw':
            k = key_of(b.get('name', ''), b.get('tail', '')); st = ensure_student(s, b.get('name', ''), b.get('tail', ''))
            if st.get('group'):
                return 200, {}, json.dumps({'ok': True, 'group': st['group'], 'already': True}).encode()
            c = counts(s); gmax = int((s.get('config') or {}).get('groupMax') or 3)
            ids = [g for g in s['groups'] if c[g] < gmax]
            if not ids:
                return 409, {}, json.dumps({'ok': False, 'error': '所有分组已满'}, ensure_ascii=False).encode()
            mn = min(c[g] for g in ids); cand = [g for g in ids if c[g] == mn]
            g = cand[int(time.time() * 1000) % len(cand)]; st['group'] = g; save(s)
            return 200, {}, json.dumps({'ok': True, 'group': g}).encode()
        if path == '/api/vote':
            k = key_of(b.get('name', ''), b.get('tail', '')); ensure_student(s, b.get('name', ''), b.get('tail', ''))
            p = s['poll']
            if not p.get('active'):
                return 400, {}, json.dumps({'ok': False, 'error': 'no active poll'}).encode()
            if k in p.get('votes', {}):
                return 400, {}, json.dumps({'ok': False, 'error': 'already voted'}).encode()
            try:
                idx = int(b.get('choice'))
            except Exception:
                return 400, {}, json.dumps({'ok': False, 'error': 'bad choice'}).encode()
            if idx < 0 or idx >= len(p.get('options') or []):
                return 400, {}, json.dumps({'ok': False, 'error': 'bad choice'}).encode()
            p.setdefault('votes', {})[k] = idx
            st_v = s['students'].get(k)
            if st_v: st_v['votes'] = st_v.get('votes', 0) + 1
            save(s)
            return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/quiz/submit':
            k = key_of(b.get('name', ''), b.get('tail', '')); ensure_student(s, b.get('name', ''), b.get('tail', ''))
            pz = (s.get('quiz') or {}).get('paper')
            if not pz or not pz.get('active'):
                return 400, {}, json.dumps({'ok': False, 'error': '答题未开始'}, ensure_ascii=False).encode()
            if k in ((s.get('quiz') or {}).get('answers') or {}):
                return 400, {}, json.dumps({'ok': False, 'error': '已经提交过'}, ensure_ascii=False).encode()
            ans = b.get('answers') or {}
            score = 0.0; total = 0; detail = []
            for q in pz['questions']:
                total += q.get('score') or 0
                ratio = _q_grade(q, ans.get(q.get('id')))
                via = 'rule'
                if q.get('type') == 'short':
                    m = _q_model(q, ans.get(q.get('id')))
                    if m is not None:
                        ratio = m / 100.0; via = 'model'
                sc = round(ratio * (q.get('score') or 0), 1)
                score += sc; detail.append({'id': q.get('id'), 'type': q.get('type'), 'score': sc, 'ratio': ratio, 'via': via})
            s.setdefault('quiz', {}).setdefault('answers', {})[k] = {
                'at': time.strftime('%Y/%m/%d %H:%M:%S'), 'score': round(score, 1), 'total': total, 'answers': ans, 'detail': detail}
            save(s)
            return 200, {}, json.dumps({'ok': True, 'score': round(score, 1), 'total': total}, ensure_ascii=False).encode()
        if path == '/api/homework':
            k = key_of(b.get('name', ''), b.get('tail', '')); ensure_student(s, b.get('name', ''), b.get('tail', ''))
            key = k + '||' + b.get('task', 'T1')
            sub = s['submissions'].get(key) or {'text': '', 'q1': '', 'q2': '', 'q3': '', 'at': time.strftime('%Y/%m/%d %H:%M:%S'), 'manual': [], 'score': None, 'files': []}
            sub.update({'text': b.get('text', ''), 'q1': b.get('q1', ''), 'q2': b.get('q2', ''), 'q3': b.get('q3', '')})
            s['submissions'][key] = sub; save(s)
            return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/upload':
            k = key_of(q.get('name', [''])[0], q.get('tail', [''])[0])
            ensure_student(s, q.get('name', [''])[0], q.get('tail', [''])[0])
            task = q.get('task', ['T1'])[0]; fn = q.get('filename', ['file.bin'])[0]
            if len(raw) > 10 * 1024 * 1024:
                return 413, {}, json.dumps({'ok': False, 'error': 'file too large (10MB)'}).encode()
            safe_k = ''.join(ch if ch.isalnum() or ch in '._-' else '_' for ch in k)[:40]
            safe_fn = ''.join(ch if ch.isalnum() or ch in '._-' else '_' for ch in fn)[:60]
            obj = PREFIX + 'uploads/' + safe_k + '/' + task + '-' + str(int(time.time() * 1000)) + '-' + safe_fn
            st2, _ = _oss('PUT', obj, raw, 'application/octet-stream')
            if st2 != 200:
                return 500, {}, json.dumps({'ok': False, 'error': 'oss put ' + str(st2) + ' ' + LAST_ERR}).encode()
            key = k + '||' + task
            sub = s['submissions'].get(key) or {'text': '', 'q1': '', 'q2': '', 'q3': '', 'at': time.strftime('%Y/%m/%d %H:%M:%S'), 'manual': [], 'score': None, 'files': []}
            sub.setdefault('files', []).append({'name': fn, 'size': len(raw), 'path': obj, 'at': time.strftime('%Y/%m/%d %H:%M:%S')})
            if fn.lower().endswith(('.md', '.txt')) and not sub.get('text'):
                try:
                    sub['text'] = raw.decode('utf-8', 'ignore')[:6000]
                except Exception:
                    pass
            s['submissions'][key] = sub; save(s)
            return 200, {'Content-Type': 'application/json; charset=utf-8'}, json.dumps({'ok': True, 'files': sub['files']}, ensure_ascii=False).encode()
        if path == '/api/admin/groupcfg':
            s.setdefault('config', {})['groupMax'] = max(1, min(10, int(b.get('max') or 3)))
            save(s); return 200, {}, json.dumps({'ok': True, 'groupMax': s['config']['groupMax']}).encode()
        if path == '/api/admin/groupadd':
            used = list(s['groups'].keys())
            letter = next((c for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if c not in used), None)
            if not letter:
                return 400, {}, json.dumps({'ok': False, 'error': '分组已达上限'}, ensure_ascii=False).encode()
            s['groups'][letter] = {'name': letter + '组', 'perf': 0}; save(s)
            return 200, {}, json.dumps({'ok': True, 'id': letter}).encode()
        if path == '/api/admin/grouprename':
            gid = b.get('id')
            if gid not in s['groups']:
                return 404, {}, json.dumps({'ok': False, 'error': 'no group'}).encode()
            nm = (b.get('name') or '').strip()
            if nm: s['groups'][gid]['name'] = nm
            save(s); return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/admin/groupdel':
            gid = b.get('id')
            if len(s['groups']) <= 1:
                return 400, {}, json.dumps({'ok': False, 'error': '至少保留一个分组'}, ensure_ascii=False).encode()
            if gid not in s['groups']:
                return 404, {}, json.dumps({'ok': False, 'error': 'no group'}).encode()
            s['groups'].pop(gid, None)
            for stx in s['students'].values():
                if stx.get('group') == gid: stx['group'] = ''
            save(s); return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/admin/quizbank':
            mode = b.get('action') or 'replace'
            incoming = b.get('bank') or {}
            s.setdefault('quiz', {})
            s['quiz'].setdefault('bank', {'choice': [], 'judge': [], 'blank': [], 'short': []})
            if mode == 'replace':
                s['quiz']['bank'] = {'choice': [], 'judge': [], 'blank': [], 'short': []}
            for t in ['choice', 'judge', 'blank', 'short']:
                for i, q in enumerate(incoming.get(t) or []):
                    item = dict(q); item['type'] = t; item['id'] = t + '-' + str(int(time.time() * 1000)) + '-' + str(i)
                    s['quiz']['bank'].setdefault(t, []).append(item)
            save(s)
            return 200, {}, json.dumps({'ok': True, 'counts': {t: len((s['quiz']['bank'] or {}).get(t) or []) for t in ['choice', 'judge', 'blank', 'short']}}, ensure_ascii=False).encode()
        if path == '/api/admin/quiz':
            s.setdefault('quiz', {})
            if b.get('action') == 'publish':
                cfg = {'mode': 'seq' if b.get('mode') == 'seq' else 'random', 'counts': b.get('counts') or {}, 'scores': b.get('scores') or {}}
                s['quiz']['config'] = cfg
                qs = []
                for t in ['choice', 'judge', 'blank', 'short']:
                    arr = list((s['quiz'].get('bank') or {}).get(t) or [])
                    if cfg['mode'] == 'random':
                        import random
                        random.shuffle(arr)
                    n = int((cfg['counts'] or {}).get(t) or 0)
                    for q in arr[:max(0, min(n, len(arr)))]:
                        item = dict(q); item['type'] = t; item['score'] = int((cfg['scores'] or {}).get(t) or 0)
                        qs.append(item)
                if not qs:
                    return 400, {}, json.dumps({'ok': False, 'error': '题库为空或各类数量为 0'}, ensure_ascii=False).encode()
                s['quiz']['paper'] = {'active': True, 'at': time.strftime('%Y/%m/%d %H:%M:%S'), 'questions': qs}
                s['quiz']['answers'] = {}
                save(s)
                return 200, {}, json.dumps({'ok': True, 'count': len(qs), 'points': sum((q.get('score') or 0) for q in qs)}, ensure_ascii=False).encode()
            if b.get('action') == 'close':
                if s['quiz'].get('paper'):
                    s['quiz']['paper']['active'] = False
                save(s); return 200, {}, json.dumps({'ok': True}).encode()
            if b.get('action') == 'clear':
                s['quiz']['paper'] = None; s['quiz']['answers'] = {}
                save(s); return 200, {}, json.dumps({'ok': True}).encode()
            if b.get('action') == 'resetbank':
                s['quiz']['bank'] = {'choice': [], 'judge': [], 'blank': [], 'short': []}
                s['quiz']['paper'] = None; s['quiz']['answers'] = {}
                save(s); return 200, {}, json.dumps({'ok': True}).encode()
            return 400, {}, json.dumps({'ok': False, 'error': 'bad action'}).encode()
        if path == '/api/admin/student':
            act = b.get('action')
            if act == 'clear':
                s['students'] = {}; s['submissions'] = {}; s['poll']['votes'] = {}
                s['buzz'] = {'enabled': False, 'running': False, 'winner': '', 'round': 0, 'at': '', 'counts': {}}
                save(s); return 200, {}, json.dumps({'ok': True}).encode()
            oldk = b.get('key', ''); st = s['students'].get(oldk)
            if not st:
                return 404, {}, json.dumps({'ok': False, 'error': 'student not found'}).encode()
            if act == 'delete':
                for kk in [x for x in s['submissions'] if x.startswith(oldk + '||')]:
                    s['submissions'].pop(kk, None)
                s['poll'].get('votes', {}).pop(oldk, None)
                s['students'].pop(oldk, None); save(s)
                return 200, {}, json.dumps({'ok': True}).encode()
            if act == 'update':
                nn = (b.get('name') or st['name']).strip(); nt = (b.get('tail') or st['tail']).strip()
                ng = b.get('group') if b.get('group') is not None else st.get('group', '')
                nk = key_of(nn, nt)
                s['students'].pop(oldk, None)
                st.update({'name': nn, 'tail': nt, 'group': ng}); s['students'][nk] = st
                if nk != oldk:
                    for kk in [x for x in s['submissions'] if x.startswith(oldk + '||')]:
                        s['submissions'][nk + kk[len(oldk):]] = s['submissions'].pop(kk)
                    if oldk in s['poll'].get('votes', {}):
                        s['poll']['votes'][nk] = s['poll']['votes'].pop(oldk)
                save(s); return 200, {}, json.dumps({'ok': True, 'key': nk}).encode()
            return 400, {}, json.dumps({'ok': False, 'error': 'bad action'}).encode()
        if path == '/api/admin/buzz':
            bz = s.setdefault('buzz', {'enabled': False, 'running': False, 'winner': '', 'at': ''})
            a = b.get('action')
            if a == 'enable': bz['enabled'] = True; bz['running'] = False; bz['winner'] = ''
            elif a == 'disable': bz['enabled'] = False; bz['running'] = False
            elif a == 'start': bz['enabled'] = True; bz['running'] = True; bz['winner'] = ''; bz['round'] = (bz.get('round') or 0) + 1; bz['at'] = time.strftime('%Y/%m/%d %H:%M:%S')
            elif a == 'reset': bz['running'] = False; bz['winner'] = ''
            save(s); return 200, {}, json.dumps({'ok': True, 'buzz': bz}, ensure_ascii=False).encode()
        if path == '/api/buzz':
            st = ensure_student(s, b.get('name', ''), b.get('tail', ''))
            bz = s.setdefault('buzz', {'enabled': False, 'running': False, 'winner': '', 'at': ''})
            if not bz.get('enabled'):
                return 400, {}, json.dumps({'ok': False, 'error': 'not enabled'}).encode()
            if bz.get('winner'):
                return 200, {}, json.dumps({'ok': True, 'winner': bz['winner']}, ensure_ascii=False).encode()
            if not bz.get('running'):
                return 400, {}, json.dumps({'ok': False, 'error': 'not running'}).encode()
            bz['winner'] = st['name']; bz['running'] = False; st['buzzes'] = st.get('buzzes', 0) + 1
            save(s); return 200, {}, json.dumps({'ok': True, 'winner': bz['winner']}, ensure_ascii=False).encode()
        if path == '/api/admin/workshop':
            s.setdefault('config', {})['workshopOpen'] = bool(b.get('open'))
            save(s); return 200, {}, json.dumps({'ok': True, 'workshopOpen': s['config']['workshopOpen']}).encode()
        if path == '/api/admin/hw':
            s.setdefault('config', {})['hwOpen'] = bool(b.get('open'))
            save(s); return 200, {}, json.dumps({'ok': True, 'hwOpen': s['config']['hwOpen']}).encode()
        if path == '/api/admin/delsub':
            sub = s['submissions'].get(b.get('key', ''))
            if sub:
                for f in (sub.get('files') or []):
                    try:
                        _oss('DELETE', f.get('path', ''))
                    except Exception:
                        pass
                s['submissions'].pop(b.get('key', ''), None)
            save(s); return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/admin/poll':
            if b.get('action') == 'stop':
                s['poll']['active'] = False
            else:
                s['poll'] = {'active': True, 'question': b.get('question', ''), 'options': [x for x in (b.get('options') or []) if str(x).strip()], 'votes': {}, 'startedAt': time.strftime('%Y/%m/%d %H:%M:%S')}
            save(s); return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/admin/group':
            k = key_of(b.get('name', ''), b.get('tail', ''))
            if k in s['students']:
                s['students'][k]['group'] = b.get('group', '')
            save(s); return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/admin/perf':
            g = b.get('group', '')
            if g in s['groups']:
                s['groups'][g]['perf'] = s['groups'][g].get('perf', 0) + int(b.get('delta', 0) or 0)
            save(s); return 200, {}, json.dumps({'ok': True, 'perf': s['groups'].get(g, {}).get('perf', 0)}).encode()
        if path == '/api/admin/model':
            act = b.get('action') or 'save'
            cfg = ((s.get('config') or {}).get('model') or {})
            if act == 'test':
                key = (b.get('apiKey') or '').strip() or cfg.get('apiKey') or os.environ.get('DEEPSEEK_API_KEY', '')
                if not key:
                    return 400, {}, json.dumps({'ok': False, 'error': '请先填写 API Key'}, ensure_ascii=False).encode()
                old = json.dumps(cfg)
                s.setdefault('config', {})['model'] = {'baseUrl': b.get('baseUrl') or cfg.get('baseUrl') or 'https://api.deepseek.com',
                                                        'model': b.get('model') or cfg.get('model') or 'deepseek-flash', 'apiKey': key}
                r = _model_chat(s, [{'role': 'user', 'content': '只回复两个字母：OK'}], 60)
                s['config']['model'] = json.loads(old) if old else cfg
                if not r.get('ok'):
                    return 502, {}, json.dumps({'ok': False, 'error': r.get('error')}, ensure_ascii=False).encode()
                return 200, {}, json.dumps({'ok': True, 'reply': str(r.get('content'))[:40], 'ms': r.get('ms'), 'model': r.get('model')}, ensure_ascii=False).encode()
            cfg['baseUrl'] = b.get('baseUrl') if b.get('baseUrl') is not None else cfg.get('baseUrl')
            cfg['model'] = b.get('model') if b.get('model') is not None else cfg.get('model')
            if b.get('apiKey'):
                cfg['apiKey'] = b['apiKey']
            s.setdefault('config', {})['model'] = cfg
            save(s)
            return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/admin/scoreai':
            sub = s['submissions'].get(b.get('key'))
            rubric = b.get('rubric') or []
            if not sub:
                return 404, {}, json.dumps({'ok': False, 'error': 'submission not found'}).encode()
            if not rubric:
                return 400, {}, json.dumps({'ok': False, 'error': '缺少评分标准'}, ensure_ascii=False).encode()
            answer = '【正文】' + str(sub.get('text') or '（空）')[:2500] + '【三问】' + str(sub.get('q1') or '') + ' / ' + str(sub.get('q2') or '') + ' / ' + str(sub.get('q3') or '')
            nl = chr(10)
            prompt = ('你是企业 AI 培训的作业评分助教。按评分标准逐项打分。评分标准（编号|标准|满分）：' + nl
                      + nl.join([str(i + 1) + '|' + str(c.get('t')) + '|' + str(c.get('pts')) for i, c in enumerate(rubric)])
                      + nl + nl + '学员作业：' + nl + answer + nl + nl
                      + '严格按每行“编号|分数|一句依据”的格式输出，不要标题、不要解释，分数不超过该项满分。')
            r = _model_chat(s, [{'role': 'user', 'content': prompt}], 1600)
            if not r.get('ok'):
                return 502, {}, json.dumps({'ok': False, 'error': r.get('error')}, ensure_ascii=False).encode()
            items = []; total = 0
            import re as _re
            for line in str(r.get('content', '')).splitlines():
                m = _re.match(r'^\s*(\d+)\s*[|｜]\s*([0-9.]+)\s*[|｜]?\s*(.*)$', line)
                if not m:
                    continue
                idx = int(m.group(1)) - 1
                if idx < 0 or idx >= len(rubric):
                    continue
                mx = float(rubric[idx].get('pts') or 0)
                sc = max(0.0, min(mx, float(m.group(2) or 0)))
                items.append({'t': rubric[idx].get('t'), 'score': sc, 'max': mx, 'why': m.group(3)[:80]})
                total += sc
            if not items:
                return 502, {}, json.dumps({'ok': False, 'error': '模型返回无法解析'}, ensure_ascii=False).encode()
            sub['score'] = {'ai': True, 'total': round(total, 1), 'override': round(total, 1), 'items': items,
                            'model': r.get('model'), 'at': time.strftime('%Y/%m/%d %H:%M:%S')}
            save(s)
            return 200, {}, json.dumps({'ok': True, 'score': sub['score']}, ensure_ascii=False).encode()
        if path == '/api/admin/score':
            sub = s['submissions'].get(b.get('key', ''))
            if sub:
                if b.get('manual') is not None:
                    sub['manual'] = b['manual']
                if b.get('score') is not None:
                    sub['score'] = b['score']
                save(s)
            return 200, {}, json.dumps({'ok': True}).encode()
        if path == '/api/admin/reset':
            scope = b.get('scope')
            if scope == 'poll':
                s['poll'] = {'active': False, 'question': '', 'options': [], 'votes': {}, 'startedAt': ''}
            elif scope == 'groups':
                for st in s['students'].values():
                    st['group'] = ''
            else:
                _m = ((s.get('config') or {}).get('model')) or None
                s = blank()
                if _m:
                    s['config']['model'] = _m
            save(s); return 200, {}, json.dumps({'ok': True}).encode()
        return 404, {}, json.dumps({'ok': False, 'error': 'no api'}).encode()
    return 404, {}, json.dumps({'ok': False, 'error': 'not found'}).encode()

def handler(environ, start_response):
    method = environ.get('REQUEST_METHOD', 'GET').upper()
    path = environ.get('PATH_INFO', '/')
    q = urllib.parse.parse_qs(environ.get('QUERY_STRING', ''), keep_blank_values=True)
    try:
        length = int(environ.get('CONTENT_LENGTH') or 0)
    except Exception:
        length = 0
    raw = environ.get('wsgi.input').read(length) if length else b''
    code, headers, body = dispatch(method, path, q, raw)
    headers = dict(headers)
    headers.setdefault('Access-Control-Allow-Origin', '*')
    headers.setdefault('Access-Control-Allow-Headers', 'Content-Type')
    headers.setdefault('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    headers.setdefault('Cache-Control', 'no-store')
    headers['Content-Length'] = str(len(body))
    status = {200: '200 OK', 400: '400 Bad Request', 404: '404 Not Found', 413: '413 Payload Too Large', 500: '500 Internal Server Error'}.get(code, '200 OK')
    start_response(status, list(headers.items()))
    return [body]
