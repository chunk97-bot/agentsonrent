# AgentRent Escrow Contract

Solana smart contract for trustless USDC payments between users and AI agents.

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

### `create_escrow`
User deposits USDC into escrow.

```rust
create_escrow(
  job_id: String,     // Max 64 chars
  amount: u64,        // USDC amount (6 decimals)
  deadline: i64,      // Unix timestamp
)
```

### `release_escrow`
User approves work, funds released to agent with fee split.

```rust
release_escrow()
```

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
