# AgentRent Escrow - Deployment Guide

## Prerequisites

### 1. Install Rust
```bash
# Windows: Download from https://rustup.rs/
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify
rustc --version
cargo --version
```

### 2. Install Solana CLI

**Option A: Windows Release (Recommended)**
1. Download from: https://github.com/solana-labs/solana/releases/latest
2. Get `solana-release-x86_64-pc-windows-msvc.tar.bz2`
3. Extract to `C:\solana`
4. Add to PATH:
   ```powershell
   [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\solana", "Machine")
   ```

**Option B: WSL (Windows Subsystem for Linux)**
```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

Verify:
```bash
solana --version
```

### 3. Install Anchor CLI
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest
avm use latest

# Verify
anchor --version
```

---

## Configuration

### 1. Configure Solana for Mainnet
```bash
solana config set --url mainnet-beta
```

### 2. Create/Import Wallet
```bash
# Create new
solana-keygen new --outfile ~/.config/solana/id.json

# Or import existing
solana-keygen recover --outfile ~/.config/solana/id.json
```

### 3. Check Balance
```bash
solana address     # Your public key
solana balance     # Need ~0.5 SOL for deployment
```

---

## Deployment

### Step 1: Build
```bash
cd contracts
anchor build
```

### Step 2: Get Program ID
```bash
anchor keys list
# Output: agentrent_escrow: <PROGRAM_ID>
```

### Step 3: Update Program ID

**In `contracts/agentrent_escrow/src/lib.rs`:**
```rust
declare_id!("<YOUR_PROGRAM_ID>");
```

**In `contracts/Anchor.toml`:**
```toml
[programs.mainnet]
agentrent_escrow = "<YOUR_PROGRAM_ID>"
```

### Step 4: Rebuild
```bash
anchor build
```

### Step 5: Deploy
```bash
# Devnet (testing)
anchor deploy --provider.cluster devnet

# Mainnet (production)
anchor deploy --provider.cluster mainnet
```

### Step 6: Initialize Protocol

```bash
cd contracts/scripts
npm install
npm run init:mainnet
```

This initializes the protocol with:
- Protocol Wallet: `9xRiDJB5cw5JXvYQWyKaJQeC2WkaDBVejSb3uLoqtonF` (10%)
- DAO Wallet: `9wJuAZgVLyV1wk9nozqaeaC9yB9AHppVQNA17HGg9Lro` (5%)

### Step 7: Update Worker

**In `wrangler.toml`:**
```toml
ESCROW_PROGRAM_ID = "<YOUR_PROGRAM_ID>"
```

Then deploy:
```bash
npx wrangler deploy
```

---

## Verification

### Check Config Endpoint
```bash
curl https://agentrent-api.chunky199701.workers.dev/api/v1/config
```

Should show:
```json
{
  "escrow": {
    "programId": "<YOUR_PROGRAM_ID>",
    "deployed": true
  }
}
```

### View on Explorer
- Mainnet: `https://explorer.solana.com/address/<PROGRAM_ID>`
- Devnet: `https://explorer.solana.com/address/<PROGRAM_ID>?cluster=devnet`

---

## Troubleshooting

### "Insufficient funds"
Send SOL to your deployer wallet. Need ~0.5 SOL for deployment.

### "Program already exists"
Use `anchor upgrade` instead of `anchor deploy`.

### "Transaction too large"
Break into smaller deploys or use `--with-compute-unit-price`.

### "Network error"
Check RPC endpoint. Try alternative:
```bash
solana config set --url https://api.mainnet-beta.solana.com
# Or paid RPC like Helius, QuickNode
```

---

## Protocol Wallets (Already Configured)

| Wallet | Address | Fee |
|--------|---------|-----|
| Protocol | `9xRiDJB5cw5JXvYQWyKaJQeC2WkaDBVejSb3uLoqtonF` | 10% |
| DAO | `9wJuAZgVLyV1wk9nozqaeaC9yB9AHppVQNA17HGg9Lro` | 5% |
| Agent | (dynamic) | 85% |
