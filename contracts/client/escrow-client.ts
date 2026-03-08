import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

// IDL will be generated after build: anchor build
// import { AgentrentEscrow } from '../target/types/agentrent_escrow';

// USDC Mints by network
const USDC_MINTS = {
  mainnet: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  devnet: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
};

/**
 * AgentRent Escrow Client
 * Handles all escrow operations for the frontend
 */
export class EscrowClient {
  private program: Program;
  private provider: AnchorProvider;
  private usdcMint: PublicKey;

  constructor(
    provider: AnchorProvider,
    programId: PublicKey,
    idl: any,
    network: 'mainnet' | 'devnet' = 'devnet'
  ) {
    this.provider = provider;
    this.program = new Program(idl, programId, provider);
    this.usdcMint = USDC_MINTS[network];
  }

  // =========================================================================
  // PDA Helpers
  // =========================================================================

  async getConfigPDA(): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      this.program.programId
    );
  }

  async getEscrowPDA(jobId: string, user: PublicKey): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), Buffer.from(jobId), user.toBuffer()],
      this.program.programId
    );
  }

  async getVaultPDA(escrow: PublicKey): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), escrow.toBuffer()],
      this.program.programId
    );
  }

  // =========================================================================
  // Instructions
  // =========================================================================

  /**
   * Initialize protocol (admin only, called once)
   */
  async initialize(
    protocolWallet: PublicKey,
    daoWallet: PublicKey,
    protocolFeeBps: number = 1000, // 10%
    daoFeeBps: number = 500        // 5%
  ): Promise<string> {
    const [config] = await this.getConfigPDA();

    const tx = await this.program.methods
      .initialize(protocolFeeBps, daoFeeBps)
      .accounts({
        config,
        authority: this.provider.wallet.publicKey,
        protocolWallet,
        daoWallet,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  /**
   * Create escrow for a job
   */
  async createEscrow(
    jobId: string,
    agent: PublicKey,
    amount: number, // in USDC (6 decimals)
    deadline: number // Unix timestamp
  ): Promise<string> {
    const user = this.provider.wallet.publicKey;
    const [config] = await this.getConfigPDA();
    const [escrow] = await this.getEscrowPDA(jobId, user);
    const [vault] = await this.getVaultPDA(escrow);
    const userTokenAccount = await getAssociatedTokenAddress(this.usdcMint, user);

    // Convert to lamports (USDC has 6 decimals)
    const amountLamports = new anchor.BN(amount * 1_000_000);
    const deadlineBN = new anchor.BN(deadline);

    const tx = await this.program.methods
      .createEscrow(jobId, amountLamports, deadlineBN)
      .accounts({
        escrow,
        escrowVault: vault,
        config,
        user,
        agent,
        userTokenAccount,
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    return tx;
  }

  /**
   * Release escrow to agent (user approves work)
   */
  async releaseEscrow(
    jobId: string,
    agent: PublicKey,
    protocolWallet: PublicKey,
    daoWallet: PublicKey
  ): Promise<string> {
    const user = this.provider.wallet.publicKey;
    const [config] = await this.getConfigPDA();
    const [escrow] = await this.getEscrowPDA(jobId, user);
    const [vault] = await this.getVaultPDA(escrow);

    const agentTokenAccount = await getAssociatedTokenAddress(this.usdcMint, agent);
    const protocolTokenAccount = await getAssociatedTokenAddress(this.usdcMint, protocolWallet);
    const daoTokenAccount = await getAssociatedTokenAddress(this.usdcMint, daoWallet);

    const tx = await this.program.methods
      .releaseEscrow()
      .accounts({
        escrow,
        escrowVault: vault,
        config,
        user,
        agentTokenAccount,
        protocolTokenAccount,
        daoTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }

  /**
   * Open a dispute
   */
  async openDispute(jobId: string, reason: string): Promise<string> {
    const caller = this.provider.wallet.publicKey;
    const [escrow] = await this.getEscrowPDA(jobId, caller);

    const tx = await this.program.methods
      .openDispute(reason)
      .accounts({
        escrow,
        caller,
      })
      .rpc();

    return tx;
  }

  /**
   * Resolve dispute (authority only)
   * winner: 0 = refund user, 1 = pay agent, 2 = split 50/50
   */
  async resolveDispute(
    jobId: string,
    user: PublicKey,
    agent: PublicKey,
    protocolWallet: PublicKey,
    daoWallet: PublicKey,
    winner: 0 | 1 | 2
  ): Promise<string> {
    const [config] = await this.getConfigPDA();
    const [escrow] = await this.getEscrowPDA(jobId, user);
    const [vault] = await this.getVaultPDA(escrow);

    const userTokenAccount = await getAssociatedTokenAddress(this.usdcMint, user);
    const agentTokenAccount = await getAssociatedTokenAddress(this.usdcMint, agent);
    const protocolTokenAccount = await getAssociatedTokenAddress(this.usdcMint, protocolWallet);
    const daoTokenAccount = await getAssociatedTokenAddress(this.usdcMint, daoWallet);

    const tx = await this.program.methods
      .resolveDispute(winner)
      .accounts({
        escrow,
        escrowVault: vault,
        config,
        authority: this.provider.wallet.publicKey,
        userTokenAccount,
        agentTokenAccount,
        protocolTokenAccount,
        daoTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }

  /**
   * Cancel escrow (user only, full refund)
   */
  async cancelEscrow(jobId: string): Promise<string> {
    const user = this.provider.wallet.publicKey;
    const [escrow] = await this.getEscrowPDA(jobId, user);
    const [vault] = await this.getVaultPDA(escrow);
    const userTokenAccount = await getAssociatedTokenAddress(this.usdcMint, user);

    const tx = await this.program.methods
      .cancelEscrow()
      .accounts({
        escrow,
        escrowVault: vault,
        user,
        userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  }

  // =========================================================================
  // Fetch Methods
  // =========================================================================

  /**
   * Get protocol config
   */
  async getConfig(): Promise<any> {
    const [config] = await this.getConfigPDA();
    return this.program.account.config.fetch(config);
  }

  /**
   * Get escrow by job ID and user
   */
  async getEscrow(jobId: string, user: PublicKey): Promise<any> {
    const [escrow] = await this.getEscrowPDA(jobId, user);
    return this.program.account.escrow.fetch(escrow);
  }

  /**
   * Get all escrows for a user
   */
  async getUserEscrows(user: PublicKey): Promise<any[]> {
    const escrows = await this.program.account.escrow.all([
      {
        memcmp: {
          offset: 8, // Skip discriminator
          bytes: user.toBase58(),
        },
      },
    ]);
    return escrows;
  }

  /**
   * Get all escrows for an agent
   */
  async getAgentEscrows(agent: PublicKey): Promise<any[]> {
    const escrows = await this.program.account.escrow.all([
      {
        memcmp: {
          offset: 8 + 32, // Skip discriminator + user pubkey
          bytes: agent.toBase58(),
        },
      },
    ]);
    return escrows;
  }
}

export default EscrowClient;
