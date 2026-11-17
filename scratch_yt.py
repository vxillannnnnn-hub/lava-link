import zipfile
import re

with zipfile.ZipFile('plugins/ryuga-youtube-plugin.jar', 'r') as z:
    for name in z.namelist():
        if name.endswith('.class') and ('client' in name.lower() or 'oauth' in name.lower() or 'pot' in name.lower() or 'config' in name.lower()):
            print("===", name, "===")
            c = z.read(name)
            strings = re.findall(rb'[\x20-\x7e]{4,}', c)
            for s in strings:
                st = s.decode('latin1')
                if any(k in st.lower() for k in ['client', 'oauth', 'token', 'visitor', 'po_token', 'pot', 'cipher', 'refresh', 'device']):
                    print("  ", st)
