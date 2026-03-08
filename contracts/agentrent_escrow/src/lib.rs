use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("EscrowXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"); // Replace with actual program ID after deploy

/// AgentRent Escrow Program
/// Handles trustless USDC payments between users and AI agents
/// Revenue split: 85% Agent / 10% Protocol / 5% DAO
#[program]
pub mod agentrent_escrow {
    use super::*;

    /// Initialize the protocol config (admin only, called once)
    pub fn initialize(
        ctx: Context<Initialize>,
        protocol_fee_bps: u16,  // 1000 = 10%
        dao_fee_bps: u16,       // 500 = 5%
    ) -> Result<()> {
        require!(protocol_fee_bps + dao_fee_bps <= 2000, EscrowError::FeeTooHigh);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.protocol_wallet = ctx.accounts.protocol_wallet.key();
        config.dao_wallet = ctx.accounts.dao_wallet.key();
        config.protocol_fee_bps = protocol_fee_bps;
        config.dao_fee_bps = dao_fee_bps;
        config.total_escrows = 0;
        config.total_volume = 0;
        config.bump = ctx.bumps.config;

        emit!(ProtocolInitialized {
            authority: config.authority,
            protocol_fee_bps,
            dao_fee_bps,
        });

        Ok(())
    }

    /// Create a new escrow for a job
    /// User deposits USDC into escrow PDA
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        job_id: String,
        amount: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(job_id.len() <= 64, EscrowError::JobIdTooLong);
        require!(deadline > Clock::get()?.unix_timestamp, EscrowError::InvalidDeadline);

        let escrow = &mut ctx.accounts.escrow;
        escrow.user = ctx.accounts.user.key();
        escrow.agent = ctx.accounts.agent.key();
        escrow.job_id = job_id.clone();
        escrow.amount = amount;
        escrow.deadline = deadline;
        escrow.status = EscrowStatus::Active;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.bump = ctx.bumps.escrow;

        // Transfer USDC from user to escrow vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        // Update config stats
        let config = &mut ctx.accounts.config;
        config.total_escrows += 1;
        config.total_volume += amount;

        emit!(EscrowCreated {
            escrow: escrow.key(),
            user: escrow.user,
            agent: escrow.agent,
            job_id,
            amount,
            deadline,
        });

        Ok(())
    }

    /// Release escrow to agent (user approves work)
    /// Splits: 85% agent, 10% protocol, 5% DAO
    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);

        let config = &ctx.accounts.config;
        let amount = escrow.amount;

        // Calculate fee splits
        let protocol_fee = (amount as u128 * config.protocol_fee_bps as u128 / 10000) as u64;
        let dao_fee = (amount as u128 * config.dao_fee_bps as u128 / 10000) as u64;
        let agent_amount = amount - protocol_fee - dao_fee;

        // Create escrow signer seeds
        let job_id = escrow.job_id.as_bytes();
        let user_key = escrow.user;
        let seeds = &[
            b"escrow",
            job_id,
            user_key.as_ref(),
            &[escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer to agent (85%)
        let transfer_to_agent = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.agent_token_account.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_to_agent, agent_amount)?;

        // Transfer to protocol (10%)
        if protocol_fee > 0 {
            let transfer_to_protocol = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.protocol_token_account.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_to_protocol, protocol_fee)?;
        }

        // Transfer to DAO (5%)
        if dao_fee > 0 {
            let transfer_to_dao = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.dao_token_account.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_to_dao, dao_fee)?;
        }

        escrow.status = EscrowStatus::Released;

        emit!(EscrowReleased {
            escrow: escrow.key(),
            job_id: escrow.job_id.clone(),
            agent_amount,
            protocol_fee,
            dao_fee,
        });

        Ok(())
    }

    /// Open a dispute (user or agent can call)
    pub fn open_dispute(ctx: Context<OpenDispute>, reason: String) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);
        require!(reason.len() <= 500, EscrowError::ReasonTooLong);

        let caller = ctx.accounts.caller.key();
        require!(
            caller == escrow.user || caller == escrow.agent,
            EscrowError::Unauthorized
        );

        escrow.status = EscrowStatus::Disputed;
        escrow.dispute_reason = Some(reason.clone());
        escrow.dispute_opened_by = Some(caller);
        escrow.dispute_opened_at = Some(Clock::get()?.unix_timestamp);

        emit!(DisputeOpened {
            escrow: escrow.key(),
            job_id: escrow.job_id.clone(),
            opened_by: caller,
            reason,
        });

        Ok(())
    }

    /// Resolve dispute (authority/arbitrator only)
    /// winner: 0 = refund user, 1 = pay agent, 2 = split 50/50
    pub fn resolve_dispute(ctx: Context<ResolveDispute>, winner: u8) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.status == EscrowStatus::Disputed, EscrowError::InvalidStatus);
        require!(winner <= 2, EscrowError::InvalidWinner);

        let config = &ctx.accounts.config;
        let amount = escrow.amount;

        // Calculate protocol + DAO fees (taken regardless of winner)
        let protocol_fee = (amount as u128 * config.protocol_fee_bps as u128 / 10000) as u64;
        let dao_fee = (amount as u128 * config.dao_fee_bps as u128 / 10000) as u64;
        let remaining = amount - protocol_fee - dao_fee;

        let job_id = escrow.job_id.as_bytes();
        let user_key = escrow.user;
        let seeds = &[
            b"escrow",
            job_id,
            user_key.as_ref(),
            &[escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        match winner {
            0 => {
                // Refund user (minus fees)
                let transfer_to_user = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: escrow.to_account_info(),
                    },
                    signer_seeds,
                );
                token::transfer(transfer_to_user, remaining)?;
            }
            1 => {
                // Pay agent
                let transfer_to_agent = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.agent_token_account.to_account_info(),
                        authority: escrow.to_account_info(),
                    },
                    signer_seeds,
                );
                token::transfer(transfer_to_agent, remaining)?;
            }
            2 => {
                // Split 50/50
                let half = remaining / 2;
                let transfer_to_user = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.user_token_account.to_account_info(),
                        authority: escrow.to_account_info(),
                    },
                    signer_seeds,
                );
                token::transfer(transfer_to_user, half)?;

                let transfer_to_agent = CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.agent_token_account.to_account_info(),
                        authority: escrow.to_account_info(),
                    },
                    signer_seeds,
                );
                token::transfer(transfer_to_agent, remaining - half)?;
            }
            _ => return Err(EscrowError::InvalidWinner.into()),
        }

        // Transfer fees
        if protocol_fee > 0 {
            let transfer_to_protocol = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.protocol_token_account.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_to_protocol, protocol_fee)?;
        }

        if dao_fee > 0 {
            let transfer_to_dao = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.dao_token_account.to_account_info(),
                    authority: escrow.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(transfer_to_dao, dao_fee)?;
        }

        escrow.status = EscrowStatus::Resolved;
        escrow.dispute_winner = Some(winner);

        emit!(DisputeResolved {
            escrow: escrow.key(),
            job_id: escrow.job_id.clone(),
            winner,
        });

        Ok(())
    }

    /// Cancel escrow (user only, before work starts)
    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);

        let job_id = escrow.job_id.as_bytes();
        let user_key = escrow.user;
        let seeds = &[
            b"escrow",
            job_id,
            user_key.as_ref(),
            &[escrow.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Full refund to user
        let transfer_to_user = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(transfer_to_user, escrow.amount)?;

        escrow.status = EscrowStatus::Cancelled;

        emit!(EscrowCancelled {
            escrow: escrow.key(),
            job_id: escrow.job_id.clone(),
            amount: escrow.amount,
        });

        Ok(())
    }
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub protocol_wallet: Pubkey,
    pub dao_wallet: Pubkey,
    pub protocol_fee_bps: u16,   // Basis points (1000 = 10%)
    pub dao_fee_bps: u16,         // Basis points (500 = 5%)
    pub total_escrows: u64,
    pub total_volume: u64,
    pub bump: u8,
}

impl Config {
    pub const SIZE: usize = 8    // discriminator
        + 32    // authority
        + 32    // protocol_wallet
        + 32    // dao_wallet
        + 2     // protocol_fee_bps
        + 2     // dao_fee_bps
        + 8     // total_escrows
        + 8     // total_volume
        + 1;    // bump
}

#[account]
pub struct Escrow {
    pub user: Pubkey,
    pub agent: Pubkey,
    pub job_id: String,
    pub amount: u64,
    pub deadline: i64,
    pub status: EscrowStatus,
    pub created_at: i64,
    pub bump: u8,
    // Dispute fields
    pub dispute_reason: Option<String>,
    pub dispute_opened_by: Option<Pubkey>,
    pub dispute_opened_at: Option<i64>,
    pub dispute_winner: Option<u8>,
}

impl Escrow {
    pub const SIZE: usize = 8    // discriminator
        + 32    // user
        + 32    // agent
        + 68    // job_id (4 + 64 max)
        + 8     // amount
        + 8     // deadline
        + 1     // status
        + 8     // created_at
        + 1     // bump
        + 505   // dispute_reason Option<String> (1 + 4 + 500)
        + 33    // dispute_opened_by Option<Pubkey>
        + 9     // dispute_opened_at Option<i64>
        + 2;    // dispute_winner Option<u8>
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Active,
    Released,
    Disputed,
    Resolved,
    Cancelled,
}

// ============================================================================
// Contexts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = Config::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Protocol fee recipient
    pub protocol_wallet: UncheckedAccount<'info>,

    /// CHECK: DAO fee recipient
    pub dao_wallet: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: String)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = user,
        space = Escrow::SIZE,
        seeds = [b"escrow", job_id.as_bytes(), user.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = user,
        token::mint = usdc_mint,
        token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Agent receiving payment
    pub agent: UncheckedAccount<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    #[account(
        mut,
        constraint = escrow.user == user.key()
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    pub user: Signer<'info>,

    #[account(mut)]
    pub agent_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub protocol_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub dao_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(mut)]
    pub escrow: Account<'info, Escrow>,

    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        constraint = escrow.status == EscrowStatus::Disputed
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"config"],
        bump = config.bump,
        constraint = authority.key() == config.authority
    )]
    pub config: Account<'info, Config>,

    pub authority: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub agent_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub protocol_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub dao_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(
        mut,
        constraint = escrow.user == user.key()
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub protocol_fee_bps: u16,
    pub dao_fee_bps: u16,
}

#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub user: Pubkey,
    pub agent: Pubkey,
    pub job_id: String,
    pub amount: u64,
    pub deadline: i64,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub job_id: String,
    pub agent_amount: u64,
    pub protocol_fee: u64,
    pub dao_fee: u64,
}

#[event]
pub struct DisputeOpened {
    pub escrow: Pubkey,
    pub job_id: String,
    pub opened_by: Pubkey,
    pub reason: String,
}

#[event]
pub struct DisputeResolved {
    pub escrow: Pubkey,
    pub job_id: String,
    pub winner: u8,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub job_id: String,
    pub amount: u64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum EscrowError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Job ID too long (max 64 chars)")]
    JobIdTooLong,
    #[msg("Deadline must be in the future")]
    InvalidDeadline,
    #[msg("Invalid escrow status for this operation")]
    InvalidStatus,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Dispute reason too long (max 500 chars)")]
    ReasonTooLong,
    #[msg("Invalid winner (must be 0, 1, or 2)")]
    InvalidWinner,
    #[msg("Total fees cannot exceed 20%")]
    FeeTooHigh,
}
