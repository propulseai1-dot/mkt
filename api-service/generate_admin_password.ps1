# Generate secure admin password and update market_server.py
$chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 20
$rng.GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

Write-Host ""
Write-Host "============================================"
Write-Host "  SILKGENESIS - NEW ADMIN PASSWORD"
Write-Host "============================================"
Write-Host ""
Write-Host "  Username : admin"
Write-Host "  Password : $password"
Write-Host ""
Write-Host "  SAVE THIS PASSWORD NOW!"
Write-Host "  It will be hashed and stored securely."
Write-Host "============================================"
Write-Host ""

# Save to a secure file (not in git)
$adminFile = 'c:\Users\propu\Desktop\SilkGenesis\ADMIN_CREDENTIALS.txt'
$content = @"
SILKGENESIS ADMIN CREDENTIALS
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

Username: admin
Password: $password

KEEP THIS FILE SECURE - DELETE AFTER MEMORIZING
DO NOT COMMIT TO GIT
"@
[System.IO.File]::WriteAllText($adminFile, $content)
Write-Host "[OK] Credentials saved to ADMIN_CREDENTIALS.txt"

# Update market_server.py - replace admin123 with new password
$p = 'c:\Users\propu\Desktop\SilkGenesis\api-service\market_server.py'
$c = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)

# Replace the hardcoded admin123 password
$old = '"password": "admin123",  # Changez ce mot de passe en production!'
$new = "`"password`": `"$password`",  # Hashed at startup by migrate_users_passwords()"
if ($c.Contains($old)) {
    $c = $c.Replace($old, $new)
    [System.IO.File]::WriteAllText($p, $c, [System.Text.Encoding]::UTF8)
    Write-Host "[OK] Admin password updated in market_server.py"
    
    # Remove BOM if added
    $bytes2 = [System.IO.File]::ReadAllBytes($p)
    if ($bytes2[0] -eq 0xEF -and $bytes2[1] -eq 0xBB -and $bytes2[2] -eq 0xBF) {
        $bytes2 = $bytes2[3..($bytes2.Length-1)]
        [System.IO.File]::WriteAllBytes($p, $bytes2)
        Write-Host "[OK] BOM removed"
    }
} else {
    Write-Host "[WARN] admin123 not found - may already be changed"
}

Write-Host ""
Write-Host "Done! Restart the backend to apply changes."
