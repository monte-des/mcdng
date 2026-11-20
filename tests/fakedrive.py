"""A small Google Drive for the tests: the OAuth redirect and the parts of the Drive v3 API that MCdng uses,
answered from memory through Playwright routes. Tests read and change its files directly, as another device
would through Google Drive for desktop."""

import hashlib, itertools, json, re
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, urlencode

FOLDER = 'application/vnd.google-apps.folder'
CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'}


class FakeDrive:
    def __init__(self):
        self.files = {'root': {'id': 'root', 'name': 'My Drive', 'mimeType': FOLDER, 'parents': [], 'trashed': False}}
        self.ids = itertools.count(1)
        self.calls = []          # (method, kind) of every API call, to count uploads and copies
        self.signins = []        # parameters of every sign-in
        self.allow_silent = True  # whether prompt=none succeeds

    # Direct access, as another device

    def stamp(self):
        return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

    def add(self, name, parent, content=None, mime=None):
        fid = f'f{next(self.ids)}'
        self.files[fid] = {'id': fid, 'name': name, 'parents': [parent], 'trashed': False, 'modifiedTime': self.stamp(),
                           'mimeType': FOLDER if content is None and mime is None else (mime or 'application/octet-stream')}
        if content is not None:
            self.set_content(fid, content)
        return fid

    def set_content(self, fid, content):
        data = content.encode() if isinstance(content, str) else content
        self.files[fid].update(content=data, md5Checksum=hashlib.md5(data).hexdigest(), modifiedTime=self.stamp())

    def children(self, parent, trashed=False):
        return [f for f in self.files.values() if parent in f['parents'] and f['trashed'] == trashed]

    def find(self, path, root):
        """The file at a path inside a folder, or None."""
        node = root
        for part in path.split('/'):
            match = [f for f in self.children(node) if f['name'] == part]
            if not match:
                return None
            node = match[-1]['id']
        return self.files[node]

    def read(self, path, root):
        f = self.find(path, root)
        return f and f['content'].decode()

    def paths(self, root, base=''):
        out = []
        for f in self.children(root):
            path = f'{base}{f["name"]}'
            if f['mimeType'] == FOLDER:
                out += self.paths(f['id'], path + '/')
            else:
                out.append(path)
        return sorted(out)

    # Routes

    async def attach(self, ctx):
        await ctx.route(re.compile(r'https://accounts\.google\.com/o/oauth2/v2/auth.*'), self.auth)
        await ctx.route(re.compile(r'https://www\.googleapis\.com/.*'), self.api)

    async def auth(self, route):
        params = {k: v[0] for k, v in parse_qs(urlparse(route.request.url).query).items()}
        self.signins.append(params)
        if params.get('prompt') == 'none' and not self.allow_silent:
            answer = {'error': 'interaction_required', 'state': params['state']}
        else:
            answer = {'access_token': f'token{len(self.signins)}', 'token_type': 'Bearer', 'expires_in': '3599',
                      'scope': params['scope'], 'state': params['state']}
        await route.fulfill(status=302, headers={'Location': f'{params["redirect_uri"]}#{urlencode(answer)}'})

    def meta(self, f):
        return {k: v for k, v in f.items() if k != 'content'}

    async def api(self, route):
        req = route.request
        if req.method == 'OPTIONS':
            return await route.fulfill(status=204, headers=CORS)
        url = urlparse(req.url)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        path = url.path
        if not (req.headers.get('authorization') or '').startswith('Bearer token'):
            return await self.reply(route, {'error': {'message': 'Invalid Credentials'}}, 401)

        if path == '/drive/v3/about':
            return await self.reply(route, {'user': {'emailAddress': 'owner@example.com', 'displayName': 'Owner'}})

        if path == '/drive/v3/files' and req.method == 'GET':
            self.calls.append(('GET', 'list'))
            q = query['q']
            parents = re.findall(r"'([^']+)' in parents", q)
            name = re.search(r"name = '([^']+)'", q)
            found = [f for f in self.files.values() if f['id'] != 'root' and not f['trashed']
                     and (not parents or set(parents) & set(f['parents'])) and (not name or f['name'] == name.group(1))]
            return await self.reply(route, {'files': [self.meta(f) for f in found]})

        if path == '/drive/v3/files' and req.method == 'POST':
            body = json.loads(req.post_data)
            self.calls.append(('POST', 'folder'))
            fid = self.add(body['name'], body['parents'][0], mime=body.get('mimeType'))
            return await self.reply(route, {'id': fid})

        m = re.fullmatch(r'/drive/v3/files/([^/]+)/copy', path)
        if m:
            body = json.loads(req.post_data)
            self.calls.append(('POST', 'copy'))
            source = self.files[m.group(1)]
            fid = self.add(body['name'], body['parents'][0], source['content'], source['mimeType'])
            return await self.reply(route, {'id': fid, 'md5Checksum': self.files[fid]['md5Checksum']})

        m = re.fullmatch(r'/drive/v3/files/([^/]+)', path)
        if m:
            f = self.files.get(m.group(1))
            if not f:
                return await self.reply(route, {'error': {'message': 'File not found'}}, 404)
            if req.method == 'PATCH':
                body = json.loads(req.post_data)
                self.calls.append(('PATCH', 'trash' if body.get('trashed') else 'rename'))
                f.update(body)
                return await self.reply(route, {'id': f['id']})
            if query.get('alt') == 'media':
                self.calls.append(('GET', 'download'))
                return await route.fulfill(status=200, body=f['content'], headers={**CORS, 'Content-Type': f['mimeType']})
            return await self.reply(route, self.meta(f))

        if path == '/upload/drive/v3/files' and req.method == 'POST':
            self.calls.append(('POST', 'upload'))
            boundary = re.search(r'boundary=(\S+)', req.headers['content-type']).group(1).encode()
            parts = req.post_data_buffer.split(b'--' + boundary)
            meta = json.loads(parts[1].split(b'\r\n\r\n', 1)[1].strip())
            content = parts[2].split(b'\r\n\r\n', 1)[1][:-2]
            fid = self.add(meta['name'], meta['parents'][0], content, meta.get('mimeType'))
            return await self.reply(route, {'id': fid, 'md5Checksum': self.files[fid]['md5Checksum']})

        m = re.fullmatch(r'/upload/drive/v3/files/([^/]+)', path)
        if m and req.method == 'PATCH':
            self.calls.append(('PATCH', 'update'))
            self.set_content(m.group(1), req.post_data_buffer)
            return await self.reply(route, {'id': m.group(1), 'md5Checksum': self.files[m.group(1)]['md5Checksum']})

        await self.reply(route, {'error': {'message': f'Not in the fake: {req.method} {path}'}}, 400)

    async def reply(self, route, data, status=200):
        await route.fulfill(status=status, body=json.dumps(data), headers={**CORS, 'Content-Type': 'application/json'})
