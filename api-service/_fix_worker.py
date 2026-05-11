"""Fix all remaining sqlite3.connect in withdrawal_worker.py"""
path = r'c:\Users\propu\Desktop\SilkGenesis\api-service\withdrawal_worker.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

import re
before = content.count('sqlite3.connect(_db_path(), check_same_thread=False)')
content = content.replace('sqlite3.connect(_db_path(), check_same_thread=False)', '_connect()')
after = content.count('sqlite3.connect(_db_path(), check_same_thread=False)')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Fixed {before - after} occurrences. Remaining: {after}")
