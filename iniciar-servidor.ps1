# Inicia o servidor do Portal do Acolitado com PM2 (auto-restart)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

# Cria pasta de logs se não existir
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

# Para instância anterior se existir
try { pm2 delete portal-acolitado 2>$null } catch {}

# Inicia com PM2
pm2 start ecosystem.config.cjs

Write-Host ""
Write-Host "Servidor iniciado! Acesse: http://localhost:8080" -ForegroundColor Green
Write-Host ""
Write-Host "Comandos uteis:" -ForegroundColor Yellow
Write-Host "  pm2 logs portal-acolitado   -- ver logs ao vivo"
Write-Host "  pm2 status                  -- status do servidor"
Write-Host "  pm2 restart portal-acolitado -- reiniciar manualmente"
Write-Host "  pm2 stop portal-acolitado    -- parar"
Write-Host ""
