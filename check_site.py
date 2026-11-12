from html.parser import HTMLParser
from pathlib import Path
class Check(HTMLParser):
 def __init__(self):
  super().__init__(); self.refs=[]; self.ids=set(); self.alts=[]
 def handle_starttag(self, tag, attrs):
  a=dict(attrs)
  if 'id' in a: self.ids.add(a['id'])
  for key in ['href','src']:
   if key in a: self.refs.append(a[key])
  if tag=='img' and 'alt' not in a: self.alts.append(a)
p=Check(); p.feed(Path('index.html').read_text(encoding='utf-8'))
missing=[r for r in p.refs if not r.startswith(('#','mailto:','http')) and not Path(r).exists()]
broken=[r for r in p.refs if r.startswith('#') and r[1:] not in p.ids]
assert not missing, missing
assert not broken, broken
assert not p.alts, p.alts
print('PASS: HTML parsed; local images, styles and scripts exist; section links resolve; all images have alt attributes.')
