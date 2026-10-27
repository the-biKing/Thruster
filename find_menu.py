
with open(r'C:\Users\joshh\AppData\Local\Programs\Antigravity IDE\resources\app\out\vs\workbench\workbench.desktop.main.js', encoding='utf-8') as fp:
    txt = fp.read()
import re
for m in re.finditer(r'([a-zA-Z0-9_]+\.order)', txt):
    s = m.start()
    print(txt[s-50:s+100])
    break
