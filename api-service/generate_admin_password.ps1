# ============================================================
# SILKGENESIS - Generate secure admin bootstrap password
# ============================================================
# This script ONLY prints the password to stdout.
# It does NOT write any file on disk and does NOT touch
# market_server.py. Copy the output into your secret
# manager (or .env that lives outside the repo).
#
# Usage:
#   PS> ./generate_admin_password.ps1
#   PS> ./generate_admin_password.ps1 -Length 32
# ============================================================

param(
    [int]$Length = 24
)

if ($Length -lt 16) {
    Write-Error "Refusing to generate a password shorter than 16 chars."
    exit 1
}

$chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_=+'
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] $Length
$rng.GetBytes($bytes)
$password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })

Write-Host ""
Write-Host "============================================"
Write-Host "  SILKGENESIS - NEW ADMIN BOOTSTRAP PASSWORD"
Write-Host "============================================"
Write-Host ""
Write-Host "  $password"
Write-Host ""
Write-Host "  Set this in your secret manager / .env as:"
Write-Host "    SILKGENESIS_BOOTSTRAP_ADMIN_PASSWORD=$password"
Write-Host "    SILKGENESIS_ROOT_ADMIN_PASSWORD=$password"
Write-Host ""
Write-Host "  This password is shown ONCE. Copy it now."
Write-Host "  It is NOT written to disk and NOT committed."
Write-Host "============================================"
Write-Host ""
