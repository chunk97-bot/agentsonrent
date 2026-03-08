# AgentRent Escrow - Deployment Guide for Windows
# ================================================

Write-Host "=== AgentRent Escrow Deployment Setup ===" -ForegroundColor Cyan

# Step 1: Check prerequisites
Write-Host "`n[1/5] Checking prerequisites..." -ForegroundColor Yellow

$solanaInstalled = $null -ne (Get-Command solana -ErrorAction SilentlyContinue)
$anchorInstalled = $null -ne (Get-Command anchor -ErrorAction SilentlyContinue)
$cargoInstalled = $null -ne (Get-Command cargo -ErrorAction SilentlyContinue)

Write-Host "Solana CLI: $(if ($solanaInstalled) { 'Installed' } else { 'NOT FOUND' })"
Write-Host "Anchor CLI: $(if ($anchorInstalled) { 'Installed' } else { 'NOT FOUND' })"
Write-Host "Cargo (Rust): $(if ($cargoInstalled) { 'Installed' } else { 'NOT FOUND' })"

if (-not $solanaInstalled) {
    Write-Host "`n--- Installing Solana CLI ---" -ForegroundColor Yellow
    Write-Host "Download from: https://github.com/solana-labs/solana/releases/latest"
    Write-Host "1. Download 'solana-release-x86_64-pc-windows-msvc.tar.bz2'"
    Write-Host "2. Extract to C:\solana"
    Write-Host "3. Add C:\solana to PATH"
    Write-Host ""
    Write-Host "Or run in PowerShell (Admin):"
    Write-Host '$env:Path += ";C:\solana"'
    Read-Host "Press Enter after installing Solana CLI..."
}

if (-not $anchorInstalled) {
    Write-Host "`n--- Installing Anchor CLI ---" -ForegroundColor Yellow
    if ($cargoInstalled) {
        Write-Host "Installing via Cargo..."
        cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
        avm install latest
        avm use latest
    } else {
        Write-Host "Cargo not found. Install Rust first:"
        Write-Host "https://rustup.rs/"
        Write-Host ""
        Write-Host "Then run: cargo install --git https://github.com/coral-xyz/anchor avm --locked"
        Read-Host "Press Enter after installing Anchor..."
    }
}

# Step 2: Configure Solana
Write-Host "`n[2/5] Configuring Solana..." -ForegroundColor Yellow

$network = Read-Host "Deploy to (devnet/mainnet)? [devnet]"
if ([string]::IsNullOrWhiteSpace($network)) { $network = "devnet" }

if ($network -eq "mainnet") {
    solana config set --url mainnet-beta
    Write-Host "WARNING: Mainnet deployment costs real SOL!" -ForegroundColor Red
} else {
    solana config set --url devnet
    Write-Host "Using devnet for testing"
}

# Check wallet
$walletPath = "$env:USERPROFILE\.config\solana\id.json"
if (-not (Test-Path $walletPath)) {
    Write-Host "`nNo wallet found. Creating new keypair..." -ForegroundColor Yellow
    solana-keygen new --outfile $walletPath
    Write-Host "IMPORTANT: Save your seed phrase securely!"
} else {
    Write-Host "Using existing wallet: $walletPath"
}

$pubkey = solana address
Write-Host "Wallet address: $pubkey"

# Check balance
$balance = solana balance
Write-Host "Balance: $balance"

if ($network -eq "devnet") {
    Write-Host "`nRequesting devnet airdrop..." -ForegroundColor Yellow
    solana airdrop 2
    solana balance
}

# Step 3: Build the escrow program
Write-Host "`n[3/5] Building escrow program..." -ForegroundColor Yellow

Set-Location -Path "$PSScriptRoot\.."
anchor build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Check errors above." -ForegroundColor Red
    exit 1
}

Write-Host "Build successful!" -ForegroundColor Green

# Step 4: Deploy
Write-Host "`n[4/5] Deploying escrow program..." -ForegroundColor Yellow

if ($network -eq "mainnet") {
    $confirm = Read-Host "Deploy to MAINNET? Type 'yes' to confirm"
    if ($confirm -ne "yes") {
        Write-Host "Deployment cancelled."
        exit 0
    }
}

anchor deploy --provider.cluster $network

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deployment failed! Check errors above." -ForegroundColor Red
    exit 1
}

# Get program ID from target/deploy
$programId = Get-Content "target/deploy/agentrent_escrow-keypair.json" | ConvertFrom-Json
# Actually, we need to check the deployed program ID from anchor output or idl

Write-Host "`nProgram deployed successfully!" -ForegroundColor Green
Write-Host "Run 'anchor keys list' to get the program ID"

# Step 5: Update configs
Write-Host "`n[5/5] Updating configuration files..." -ForegroundColor Yellow

$programId = Read-Host "Enter the deployed program ID"

Write-Host "`nUpdate these files with program ID: $programId"
Write-Host "1. contracts/agentrent_escrow/src/lib.rs - declare_id!(...)"
Write-Host "2. contracts/Anchor.toml - [programs.$network]"
Write-Host "3. wrangler.toml - ESCROW_PROGRAM_ID"

Write-Host "`n=== Deployment Complete ===" -ForegroundColor Green
Write-Host "Program ID: $programId"
Write-Host "Network: $network"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Initialize protocol: npx ts-node scripts/init-protocol.ts"
Write-Host "2. Update wrangler.toml ESCROW_PROGRAM_ID"
Write-Host "3. Redeploy worker: npx wrangler deploy"
