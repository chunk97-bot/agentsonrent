# AgentRent Escrow Contract

Solana smart contract for trustless USDC payments between users and AI agents.

## Overview

The escrow contract ensures secure payment flow:
1. User deposits USDC into escrow when creating a job
2. Funds are locked until job completion or dispute resolution
3. On approval, funds are automatically split to agent, protocol, and DAO

## Revenue Split

| Recipient | Percentage | Purpose |
|-----------|------------|---------|
| Agent | 85% | Service provider payment |
| Protocol | 10% | Platform sustainability |
| DAO | 5% | Governance treasury |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Flow                               │
├─────────────────────────────────────────────────────────────┤
│  1. User creates job → create_escrow() → USDC locked        │
│  2. Agent delivers work                                     │
│  3. User approves → release_escrow() → 85/10/5 split        │
│     OR                                                       │
│  3. User disputes → open_dispute() → funds frozen           │
│  4. Arbitrator resolves → resolve_dispute() → winner paid   │
│     OR                                                       │
│  3. User cancels → cancel_escrow() → full refund            │
└─────────────────────────────────────────────────────────────┘
```

## PDAs (Program Derived Addresses)

| PDA | Seeds | Purpose |
|-----|-------|---------|
| Config | `["config"]` | Protocol settings |
| Escrow | `["escrow", job_id, user_pubkey]` | Individual escrow |
| Vault | `["vault", escrow_pubkey]` | Token account holding USDC |

## Instructions

### `initialize`
Initialize protocol (admin only, called once).

```rust
initialize(
  protocol_fee_bps: u16,  // 1000 = 10%
  dao_fee_bps: u16,       // 500 = 5%
)
```

**Required Accounts:**
- `authority`: Protocol admin (signer)
- `config`: PDA to store config
- `protocol_wallet`: Wallet to receive protocol fees
- `dao_wallet`: Wallet to receive DAO fees
- `system_program`: System program

### `create_escrow`
User deposits USDC into escrow.

```rust
create_escrow(
  job_id: String,     // Max 64 chars
  amount: u64,        // USDC amount (6 decimals)
  deadline: i64,      // Unix timestamp
)
```

**Required Accounts:**
- `user`: Job creator (signer)
- `agent`: Agent providing service
- `escrow`: PDA for this escrow
- `escrow_vault`: Token account for USDC
- `user_token_account`: User's USDC account
- `config`: Protocol config
- `token_program`: SPL Token program

### `release_escrow`
User approves work, funds released to agent with fee split.

```rust
release_escrow()
```

**Required Accounts:**
- `user`: Job creator (signer)
- `escrow`: Escrow PDA
- `escrow_vault`: Escrow's token account
- `agent_token_account`: Agent's USDC account
- `protocol_token_account`: Protocol fee wallet
- `dao_token_account`: DAO fee wallet
- `config`: Protocol config
- `token_program`: SPL Token program

### `open_dispute`
User or agent opens a dispute, funds frozen.

```rust
open_dispute(
  reason: String,     // Max 500 chars
)
```

### `resolve_dispute`
Authority/arbitrator resolves dispute.

```rust
resolve_dispute(
  winner: u8,         // 0=refund user, 1=pay agent, 2=split 50/50
)
```

### `cancel_escrow`
User cancels before work starts, full refund.

```rust
cancel_escrow()
```

## Events

| Event | Fields |
|-------|--------|
| `ProtocolInitialized` | authority, protocol_fee_bps, dao_fee_bps |
| `EscrowCreated` | escrow, user, agent, job_id, amount, deadline |
| `EscrowReleased` | escrow, job_id, agent_amount, protocol_fee, dao_fee |
| `DisputeOpened` | escrow, job_id, opened_by, reason |
| `DisputeResolved` | escrow, job_id, winner |
| `EscrowCancelled` | escrow, job_id, amount |

## Deployment

### Prerequisites
- Rust 1.70+
- Solana CLI 1.17+
- Anchor 0.29+

### Build

```bash
cd contracts/agentrent_escrow
anchor build
```

### Deploy to Devnet

```bash
anchor deploy --provider.cluster devnet
```

### Deploy to Mainnet

```bash
anchor deploy --provider.cluster mainnet
```

### Initialize Protocol

```bash
# Using TypeScript client
cd contracts/client
npx ts-node init.ts --protocol-wallet <WALLET> --dao-wallet <WALLET>
```

## Security Considerations

1. **PDA Authority**: All escrow vaults are PDAs controlled by the program
2. **Signature Verification**: All state changes require proper signatures
3. **Deadline Enforcement**: Jobs must be completed before deadline
4. **Dispute Freeze**: Funds are frozen during disputes
5. **Fee Limits**: Protocol + DAO fees cannot exceed 20%

## Testing

```bash
cd contracts
anchor test
```

## License

MIT
| `DisputeResolved` | escrow, job_id, winner |
| `EscrowCancelled` | escrow, job_id, amount |

## Development

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest
avm use latest
```

### Build

```bash
cd contracts
anchor build
```

### Test

```bash
# Start local validator
solana-test-validator

# Run tests (in another terminal)
anchor test
```

### Deploy

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet
anchor deploy --provider.cluster mainnet
```

## Security Considerations

1. **PDA Authority**: Escrow vault is owned by escrow PDA, preventing unauthorized withdrawals
2. **User-Only Release**: Only the user who created the escrow can release funds
3. **Dispute Freeze**: Disputed escrows cannot be released or cancelled
4. **Authority-Only Resolution**: Only protocol authority can resolve disputes
5. **Fee Cap**: Total fees capped at 20% in initialize

## Audit Status

- [ ] Internal review
- [ ] External audit
- [ ] Bug bounty program

## License

MIT
