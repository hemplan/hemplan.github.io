#!/usr/bin/env python3
"""Builds the two versions of Hemplan from one shared source.

    python3 build.py

src/core/        shared by both versions (page.html, app.css, app.js)
src/work/        extras for the work version (work.html, work.css, work.js)

Output:
  docs/index.html          home version, GitHub Pages  (hemplan.github.io)
  docs/arbete/index.html   work version, GitHub Pages  (hemplan.github.io/arbete/)
  build/home.html          home version for the Claude artifact
  build/work.html          work version for the Claude artifact

The same file runs in both places: Claude-only features switch on when the page
is opened inside Claude. GitHub Pages needs a full HTML document, the Claude
artifact gets the page content only (Claude adds the document around it).
"""
import json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')

VARIANTS = {
    'home': {
        'id': 'home', 'title': 'Hemplan 3D',
        'appUrl': 'https://claude.ai/artifact/SQ6qEdbTfwtsJMcC3HZ4Ze',
        'storeKey': 'hemplan3d.v1', 'idb': 'hemplan3d', 'collapseKey': 'hemplan3d.collapsed',
        'templates': 'templates.json',
        'extra': None, 'pages': 'docs/index.html', 'artifact': 'build/home.html',
    },
    'work': {
        'id': 'work', 'title': 'Hemplan Pro',
        'appUrl': 'https://claude.ai/artifact/Xvk4PM1qbAnR6a4uxfYS4o',
        'storeKey': 'hemplan3d.pro.v1', 'idb': 'hemplan3d-pro', 'collapseKey': 'hemplan3d.pro.collapsed',
        'templates': '../templates.json',
        'extra': 'work', 'pages': 'docs/arbete/index.html', 'artifact': 'build/work.html',
    },
}

GITHUB_HEAD = '''<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.4 system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
'''
GITHUB_TAIL = '\n</body>\n</html>\n'


def read(*parts):
    path = os.path.join(SRC, *parts)
    return open(path, encoding='utf-8').read() if os.path.exists(path) else ''


def build(v):
    page, css, js = read('core', 'page.html'), read('core', 'app.css'), read('core', 'app.js')
    x = v['extra']
    xcss = read(x, x + '.css') if x else ''
    xjs = read(x, x + '.js') if x else ''
    xhtml = read(x, x + '.html') if x else ''
    slots = dict(re.findall(r'<!--@(\w+)-->\n(.*?)<!--@END-->', xhtml, re.S))

    conf = {k: v[k] for k in ('id', 'title', 'appUrl', 'storeKey', 'idb', 'collapseKey', 'templates')}
    js, n = re.subn(r'/\*@VARIANT\*/.*?/\*@END\*/', lambda m: '/*@VARIANT*/' + json.dumps(conf, ensure_ascii=False) + '/*@END*/', js, count=1)
    assert n == 1, 'VARIANT marker missing in app.js'
    assert '/*@SLOT:JS*/' in js, 'JS slot missing in app.js'
    js = js.replace('/*@SLOT:JS*/', xjs)

    out = page.replace('{{TITLE}}', v['title']).replace('{{CSS}}', css + xcss).replace('{{JS}}', '(() => {\n' + js + '})();')
    for name in ('LEFT', 'STAGE'):
        out = out.replace('<!--@SLOT:%s-->\n' % name, slots.get(name, ''))
    assert '{{' not in out and '@SLOT' not in out, 'unfilled placeholder in ' + v['id']
    return out


def write(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8').write(text)


if __name__ == '__main__':
    for v in VARIANTS.values():
        page = build(v)
        write(v['artifact'], page)
        write(v['pages'], GITHUB_HEAD + page + GITHUB_TAIL)
        print('built', v['id'], len(page) // 1024, 'KB')
