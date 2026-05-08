import sqlite3

DB_PATH = r"C:\Users\propu\Desktop\SilkGenesis\api-service\silkgenesis_data.db"

con = sqlite3.connect(DB_PATH)
cur = con.cursor()

cur.execute("SELECT password FROM users WHERE lower(username)='cursor' LIMIT 1")
row = cur.fetchone()
if not row:
    raise RuntimeError("cursor user not found, cannot copy password hash")
cursor_hash = row[0]

cur.execute(
    "UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup_codes='[]' "
    "WHERE lower(username)='silkadmin'"
)
print(f"SILKADMIN_UPDATED_ROWS={cur.rowcount}")

cur.execute(
    "INSERT OR IGNORE INTO users "
    "(username,password,role,status,balance,xmr_address,avatar,pos,totp_enabled,totp_secret,totp_backup_codes) "
    "VALUES ('godmode',?,'admin','active',0.0,'',NULL,0,0,NULL,'[]')",
    (cursor_hash,),
)
print(f"GODMODE_INSERTED_IF_MISSING={cur.rowcount}")

cur.execute(
    "UPDATE users SET password=?, role='admin', status='active', "
    "totp_enabled=0, totp_secret=NULL, totp_backup_codes='[]' "
    "WHERE lower(username)='godmode'",
    (cursor_hash,),
)
print(f"GODMODE_UPDATED_ROWS={cur.rowcount}")

con.commit()
con.close()
print("DONE=1")
