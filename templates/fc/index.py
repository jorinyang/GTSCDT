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
            'submissions': {}, 'config': {'hwOpen': False, 'workshopOpen': False, 'groupMax': 3}, 'buzz': {'enabled': False, 'running': False, 'winner': '', 'round': 0, 'at': ''}, 'updatedAt': ''}

def load():
    st, b = _oss('GET', STATE_KEY)
    if st != 200:
        return blank()
    try:
        s = json.loads(b.decode('utf-8')); base = blank(); base.update(s); return base
    except Exception:
        return blank()

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
            'groupCounts': counts(s), 'groups': [{'id': g, 'name': s['groups'][g]['name']} for g in s['groups']],
            'submissions': subs}

def admin_view(s):
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
                s = blank()
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
