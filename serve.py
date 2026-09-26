#!/usr/bin/env python3
"""Echo English 本地静态服务器（支持 HTTP Range）。

为什么不用 python3 -m http.server：
    标准库的 SimpleHTTPRequestHandler 不实现 Range 请求。对本目录里
    286 MB 的资料视频来说，后果是——每次点击句子跳转，浏览器
    都得把整个文件重新拉一遍，拖动进度条基本不可用。

用法：
    python3 serve.py            # 默认 http://127.0.0.1:8777/
    python3 serve.py 8080       # 换端口

排查跳转流量（会打印每个 Range 请求）：
    NAVAL_LOG_MEDIA=1 python3 serve.py

只监听 127.0.0.1，不对外暴露。
"""

import os
import re
import sys
import functools
import http.server
import json
import socketserver
import tempfile
import datetime
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
LIBRARY_CONFIG = os.path.join(ROOT, '.library-root')
DEFAULT_LIBRARY_ROOT = os.path.abspath(os.environ.get(
    'ENGLISH_LIBRARY_ROOT', os.path.join(ROOT, '..', '..', 'Sync', 'English', 'learning-library')))
if os.environ.get('ENGLISH_LIBRARY_ROOT'):
    LIBRARY_ROOT = DEFAULT_LIBRARY_ROOT
else:
    try:
        configured = open(LIBRARY_CONFIG, encoding='utf-8').read().strip()
    except OSError:
        configured = ''
    LIBRARY_ROOT = os.path.abspath(configured or DEFAULT_LIBRARY_ROOT)
ITEMS_ROOT = os.path.join(LIBRARY_ROOT, 'items')
CHUNK = 256 * 1024
# 单次 Range 响应最多回多少字节。浏览器拖动进度条时常常直接请求
# 「从 N 到文件末尾」，若不封顶，服务器会开始传几百 MB，直到浏览器取够
# 了主动断开。封顶后每次只回一小段，浏览器按需续请求——拖动更跟手，
# 也不会产生大量被掐断的连接。
MAX_RANGE = 16 * 1024 * 1024
# NAVAL_LOG_MEDIA=1 时打印每个媒体请求（含 Range 头）
LOG_MEDIA = os.environ.get('NAVAL_LOG_MEDIA') == '1'
MEDIA_RE = re.compile(r'\.(mp4|m4a|webm|mp3|wav|ogg|mov|mkv)(\?|$)')
ITEM_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{1,79}$')


def atomic_write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix='.write-', dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def parse_frontmatter(path):
    try:
        raw = open(path, encoding='utf-8').read()
    except OSError:
        return None
    m = re.match(r'\A---\s*\n(.*?)\n---(?:\n|$)', raw, re.S)
    if not m:
        return None
    result = {}
    for line in m.group(1).splitlines():
        match = re.match(r'^([a-zA-Z_][\w-]*):\s*(.*?)\s*$', line)
        if not match:
            continue
        key, value = match.groups()
        if value.startswith('[') and value.endswith(']'):
            result[key] = [part.strip().strip("'\"") for part in value[1:-1].split(',') if part.strip()]
        else:
            result[key] = value.strip("'\"")
    return result


def item_dir(item_id):
    if not ITEM_ID_RE.fullmatch(item_id):
        return None
    path = os.path.realpath(os.path.join(ITEMS_ROOT, item_id))
    if os.path.commonpath([os.path.realpath(ITEMS_ROOT), path]) != os.path.realpath(ITEMS_ROOT):
        return None
    return path


def item_summary(folder, meta):
    item_id = meta.get('id') or os.path.basename(folder)
    def item_media_path(field):
        rel = meta.get(field, '')
        if not rel or os.path.isabs(rel):
            return ''
        candidate = os.path.realpath(os.path.join(folder, rel))
        media_root = os.path.realpath(os.path.join(folder, 'media'))
        return candidate if os.path.commonpath([media_root, candidate]) == media_root and os.path.isfile(candidate) else ''
    media_abs = item_media_path('media_path')
    poster_abs = item_media_path('poster_path')
    media_ok = bool(media_abs)
    compiled = os.path.isfile(os.path.join(folder, 'compiled', 'data.js'))
    return {
        'id': item_id,
        'title': meta.get('title', item_id),
        'type': meta.get('type', 'video'),
        'source_url': meta.get('source_url', ''),
        'channel': meta.get('channel', ''),
        'guest': meta.get('guest', ''),
        'duration_seconds': int(meta.get('duration_seconds') or 0),
        'status': meta.get('status', 'saved'),
        'tags': meta.get('tags', []),
        'updated_at': meta.get('updated_at', ''),
        'has_transcript': os.path.isfile(os.path.join(folder, meta.get('transcript_file', 'transcript.md'))) or bool(glob_imports(folder)),
        'has_vocab': os.path.isfile(os.path.join(folder, meta.get('vocab_file', 'vocab.md'))),
        'has_translation': os.path.isfile(os.path.join(folder, meta.get('translation_file', 'translation.md'))),
        'has_media': media_ok,
        'media_url': '/api/items/' + item_id + '/media' if media_ok else '',
        'media_name': os.path.basename(media_abs) if media_ok else '',
        'poster_url': '/api/items/' + item_id + '/poster' if poster_abs else '',
        'can_study': compiled,
    }


def glob_imports(folder):
    source = os.path.join(folder, 'source')
    if not os.path.isdir(source):
        return []
    return [name for name in os.listdir(source) if re.fullmatch(r'imported-[0-9-]+\.md', name)]


def progress_file(item_id):
    folder = item_dir(item_id)
    return os.path.join(folder, 'progress.md') if folder and os.path.isdir(folder) else None


def progress_from_markdown(path):
    try:
        raw = open(path, encoding='utf-8').read()
    except OSError:
        return {}
    m = re.search(r'```json\s*\n(.*?)\n```', raw, re.S)
    if not m:
        return {}
    try:
        value = json.loads(m.group(1))
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 才有正确的 206 语义与连接复用
    protocol_version = 'HTTP/1.1'
    server_version = 'EnglishDesk/1.0'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self, limit=2 * 1024 * 1024):
        length = int(self.headers.get('Content-Length', '0'))
        if length < 0 or length > limit:
            raise ValueError('请求内容过大')
        raw = self.rfile.read(length)
        value = json.loads(raw.decode('utf-8'))
        if not isinstance(value, dict):
            raise ValueError('请求格式无效')
        return value

    def api_error(self, message, status=400):
        self.send_json({'error': message}, status)

    def api_host_allowed(self):
        host = (self.headers.get('Host') or '').split(':', 1)[0].strip('[]').lower()
        return host in ('127.0.0.1', 'localhost', '::1')

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        parts = [urllib.parse.unquote(x) for x in parsed.path.strip('/').split('/') if x]
        if parts and parts[0] == 'api' and not self.api_host_allowed():
            return self.api_error('本地资料接口只接受 localhost 请求', 403)
        if parts == ['api', 'library-directory']:
            return self.send_json({'path': LIBRARY_ROOT})
        if parts == ['api', 'library']:
            items = []
            if os.path.isdir(ITEMS_ROOT):
                for name in sorted(os.listdir(ITEMS_ROOT)):
                    folder = item_dir(name)
                    meta = parse_frontmatter(os.path.join(folder, 'index.md')) if folder else None
                    if meta:
                        items.append(item_summary(folder, meta))
            return self.send_json({'items': items})
        if len(parts) >= 3 and parts[:2] == ['api', 'items']:
            folder = item_dir(parts[2])
            if not folder or not os.path.isdir(folder):
                return self.api_error('资料不存在', 404)
            meta = parse_frontmatter(os.path.join(folder, 'index.md'))
            if not meta:
                return self.api_error('资料信息无法读取', 422)
            if len(parts) == 3:
                summary = item_summary(folder, meta)
                docs = []
                for filename, label in [('index.md','资料信息'), ('source.md','来源链接'), ('transcript.md','逐字稿'), ('translation.md','中文翻译'), ('vocab.md','词汇材料'), ('notes.md','内容笔记'), ('quiz.md','自测题'), ('progress.md','学习记录')]:
                    if os.path.isfile(os.path.join(folder, filename)):
                        docs.append({'name': filename, 'label': label})
                for filename, label in [('content.md','来源字幕快照'), ('ocr-english-frames-20260926.md','首轮逐帧 OCR 记录'), ('ocr-english-frames-second-pass-20260926.tsv','复核逐帧 OCR 记录')]:
                    if os.path.isfile(os.path.join(folder, 'source', filename)):
                        docs.append({'name': 'source/' + filename, 'label': label})
                for filename in glob_imports(folder):
                    docs.append({'name': 'source/' + filename, 'label': '导入原文'})
                return self.send_json({'item': summary, 'documents': docs})
            if len(parts) == 4 and parts[3] in ('media', 'poster'):
                field = 'media_path' if parts[3] == 'media' else 'poster_path'
                rel = meta.get(field, '')
                media_root = os.path.realpath(os.path.join(folder, 'media'))
                path = os.path.realpath(os.path.join(folder, rel)) if rel and not os.path.isabs(rel) else ''
                if not path or os.path.commonpath([media_root, path]) != media_root or not os.path.isfile(path):
                    return self.api_error('媒体文件不存在', 404)
                return self.send_file_range(path)
            if len(parts) == 4 and parts[3] == 'progress':
                return self.send_json({'progress': progress_from_markdown(os.path.join(folder, 'progress.md'))})
            if len(parts) == 5 and parts[3] == 'bundle' and parts[4] in ('data.js', 'data.cn.js'):
                path = os.path.join(folder, 'compiled', parts[4])
                if not os.path.isfile(path):
                    return self.api_error('此资料尚未编译为学习页面数据', 404)
                content_type = 'application/javascript; charset=utf-8'
                body = open(path, 'rb').read()
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
            if len(parts) == 5 and parts[3] == 'files':
                name = parts[4]
                allowed = {'index.md', 'source.md', 'transcript.md', 'vocab.md', 'translation.md', 'notes.md', 'quiz.md', 'progress.md'}
                if name in allowed:
                    path = os.path.join(folder, name)
                elif name in ('source/content.md', 'source/ocr-english-frames-20260926.md', 'source/ocr-english-frames-second-pass-20260926.tsv'):
                    path = os.path.join(folder, name)
                elif name.startswith('source/') and name[7:] in glob_imports(folder):
                    path = os.path.join(folder, 'source', name[7:])
                else:
                    return self.api_error('不支持读取此文件', 400)
                if not os.path.isfile(path):
                    return self.api_error('文件不存在', 404)
                body = open(path, 'rb').read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/markdown; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        parts = [urllib.parse.unquote(x) for x in parsed.path.strip('/').split('/') if x]
        if parts and parts[0] == 'api' and not self.api_host_allowed():
            return self.api_error('本地资料接口只接受 localhost 请求', 403)
        if parts == ['api', 'library-directory']:
            global LIBRARY_ROOT, ITEMS_ROOT
            try:
                import subprocess
                # Consume the browser's JSON body before returning this keep-alive
                # connection to the HTTP server for another request.
                self.read_json(1024)
                script = 'POSIX path of (choose folder with prompt "选择 English Desk 资料目录")'
                result = subprocess.run(
                    ['osascript', '-e', script], capture_output=True, text=True,
                    timeout=120, check=False)
                selected = result.stdout.strip()
                if not selected:
                    if result.returncode != 0 and 'User canceled' not in result.stderr:
                        return self.api_error('目录选择器未能打开：' + (result.stderr.strip() or 'osascript 执行失败'), 500)
                    return self.send_json({'path': LIBRARY_ROOT, 'cancelled': True})
                LIBRARY_ROOT = os.path.abspath(selected)
                ITEMS_ROOT = os.path.join(LIBRARY_ROOT, 'items')
                os.makedirs(ITEMS_ROOT, exist_ok=True)
                atomic_write(LIBRARY_CONFIG, LIBRARY_ROOT + '\n')
                return self.send_json({'path': LIBRARY_ROOT})
            except Exception as exc:
                return self.api_error('无法打开本机目录选择器：' + str(exc), 500)
        if len(parts) == 4 and parts[:2] == ['api', 'items']:
            item_id, action = parts[2], parts[3]
            folder = item_dir(item_id)
            if not folder or not os.path.isdir(folder):
                return self.api_error('资料不存在', 404)
            index_path = os.path.join(folder, 'index.md')
            try:
                body = self.read_json(2 * 1024 * 1024)
            except (ValueError, json.JSONDecodeError) as exc:
                return self.api_error(str(exc))
            if action == 'progress':
                state = body.get('progress', {})
                if not isinstance(state, dict):
                    return self.api_error('进度格式无效')
                encoded = json.dumps(state, ensure_ascii=False, indent=2)
                md = '# 学习进度\n\n<!-- english-study-progress:start -->\n```json\n' + encoded + '\n```\n<!-- english-study-progress:end -->\n'
                try:
                    atomic_write(os.path.join(folder, 'progress.md'), md)
                except OSError as exc:
                    return self.api_error(str(exc), 500)
                return self.send_json({'ok': True})
            if action in ('archive', 'restore'):
                try:
                    raw = open(index_path, encoding='utf-8').read()
                    meta = parse_frontmatter(index_path) or {}
                    if action == 'restore':
                        if (os.path.isfile(os.path.join(folder, 'compiled', 'data.js'))
                                and meta.get('review_status') == 'complete'):
                            target_status = 'ready'
                        elif meta.get('review_status') == 'complete':
                            target_status = 'reviewed'
                        elif os.path.isfile(os.path.join(folder, 'transcript.md')) or glob_imports(folder):
                            target_status = 'source_ready'
                        else:
                            target_status = 'saved'
                    else:
                        target_status = 'archived'
                    raw = re.sub(r'(?m)^status:.*$', 'status: ' + target_status, raw, count=1)
                    raw = re.sub(r'(?m)^updated_at:.*$', 'updated_at: ' + datetime.date.today().isoformat(), raw, count=1)
                    atomic_write(index_path, raw)
                except OSError as exc:
                    return self.api_error(str(exc), 500)
                return self.send_json({'ok': True})
        return self.api_error('未知的本地资料操作', 404)

    def end_headers(self):
        # 让浏览器知道可以对媒体文件发 Range 请求（seek 的前提）
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_file_range(self, path):
        rng = self.headers.get('Range')
        size = os.path.getsize(path)
        if not rng:
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Length', str(size))
            self.send_header('Last-Modified', self.date_time_string(os.path.getmtime(path)))
            self.end_headers()
            with open(path, 'rb') as f:
                self.copyfile(f, self.wfile)
            return
        m = re.match(r'bytes=(\d*)-(\d*)\s*$', rng.strip())
        if not m or (m.group(1) == '' and m.group(2) == ''):
            return self.api_error('Range 请求无效', 416)
        first, last = m.group(1), m.group(2)
        if first == '':
            start, end = max(0, size - int(last)), size - 1
        else:
            start, end = int(first), min(int(last) if last else size - 1, size - 1)
        end = min(end, start + MAX_RANGE - 1)
        if size == 0 or start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        with open(path, 'rb') as f:
            f.seek(start)
            self._range_left = end - start + 1
            self.send_response(206)
            self.send_header('Content-Type', self.guess_type(path))
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            self.send_header('Content-Length', str(self._range_left))
            self.send_header('Last-Modified', self.date_time_string(os.path.getmtime(path)))
            self.end_headers()
            self.copyfile(f, self.wfile)

    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()

        m = re.match(r'bytes=(\d*)-(\d*)\s*$', rng.strip())
        if not m:
            return super().send_head()

        size = os.path.getsize(path)
        first, last = m.group(1), m.group(2)
        if first == '' and last == '':
            return super().send_head()
        if first == '':                     # bytes=-N  取末尾 N 字节
            start = max(0, size - int(last))
            end = size - 1
        else:                               # bytes=N- / bytes=N-M
            start = int(first)
            end = int(last) if last else size - 1
            end = min(end, size - 1)
        # 即使客户端要「N 到末尾」，也只回一段，其余由它续请求
        end = min(end, start + MAX_RANGE - 1)

        if size == 0 or start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None

        f = open(path, 'rb')
        f.seek(start)
        self._range_left = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(self._range_left))
        self.send_header('Last-Modified', self.date_time_string(os.path.getmtime(path)))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, '_range_left', None)
        if left is None:
            return super().copyfile(source, outputfile)
        self._range_left = None
        while left > 0:
            chunk = source.read(min(CHUNK, left))
            if not chunk:
                break
            try:
                outputfile.write(chunk)
            except (ConnectionResetError, BrokenPipeError):
                return          # 浏览器取够了主动断开，属正常，不必报错
            left -= len(chunk)

    def log_request(self, code='-', size='-'):
        # 媒体文件会产生大量 Range 请求，默认静默；
        # NAVAL_LOG_MEDIA=1 时全部打印，可直观看到「跳到某处只取了多少字节」。
        rng = self.headers.get('Range') if self.headers else None
        msg = '%s %s → %s%s' % (self.command, self.path, code,
                                (' Range=%s' % rng) if rng else '')
        if not LOG_MEDIA and MEDIA_RE.search(self.path):
            return
        sys.stderr.write('%s - %s\n' % (self.address_string(), msg))

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            self.close_connection = True


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        # 长 Range 请求被浏览器中途掐断是常态，不要打堆栈吓人
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main():
    port = 8777
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print('端口号必须是数字，例如：python3 serve.py 8080')
            return 1

    handler = functools.partial(RangeHandler)
    try:
        httpd = ReusableServer(('127.0.0.1', port), handler)
    except OSError as e:
        print('端口 %d 起不来：%s' % (port, e))
        print('可能已经有服务在跑，换一个端口试试：python3 serve.py %d' % (port + 1))
        return 1

    print('English Desk 已启动（Markdown 资料库 + 支持 Range 的媒体服务）')
    print('  → http://127.0.0.1:%d/' % port)
    print('  按 Ctrl+C 停止')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')
    finally:
        httpd.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
