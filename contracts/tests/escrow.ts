import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { expect } from 'chai';
import { AgentrentEscrow } from '../target/types/agentrent_escrow';

describe('agentrent_escrow', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AgentrentEscrow as Program<AgentrentEscrow>;

  // Test accounts
  let usdcMint: PublicKey;
  let protocolWallet: Keypair;
  let daoWallet: Keypair;
  let user: Keypair;
  let agent: Keypair;
  let userTokenAccount: PublicKey;
  let agentTokenAccount: PublicKey;
  let protocolTokenAccount: PublicKey;
  let daoTokenAccount: PublicKey;

  // PDAs
  let configPDA: PublicKey;
  let escrowPDA: PublicKey;
  let vaultPDA: PublicKey;

  const JOB_ID = 'test-job-001';
  const ESCROW_AMOUNT = 100_000_000; // 100 USDC (6 decimals)
  const DEADLINE = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now

  before(async () => {
    // Generate keypairs
    protocolWallet = Keypair.generate();
    daoWallet = Keypair.generate();
    user = Keypair.generate();
    agent = Keypair.generate();

    // Airdrop SOL to accounts
    const airdropAmount = 10 * anchor.web3.LAMPORTS_PER_SOL;
    await Promise.all([
      provider.connection.requestAirdrop(user.publicKey, airdropAmount),
      provider.connection.requestAirdrop(agent.publicKey, airdropAmount),
      provider.connection.requestAirdrop(protocolWallet.publicKey, airdropAmount),
      provider.connection.requestAirdrop(daoWallet.publicKey, airdropAmount),
    ]);

    // Wait for airdrop confirmation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create USDC mock mint
    usdcMint = await createMint(
      provider.connection,
      user,
      user.publicKey,
      null,
      6 // USDC decimals
    );

    // Create token accounts
    userTokenAccount = await createAccount(
      provider.connection,
      user,
      usdcMint,
      user.publicKey
    );

    agentTokenAccount = await createAccount(
      provider.connection,
      agent,
      usdcMint,
      agent.publicKey
    );

    protocolTokenAccount = await createAccount(
      provider.connection,
      protocolWallet,
      usdcMint,
      protocolWallet.publicKey
    );

    daoTokenAccount = await createAccount(
      provider.connection,
      daoWallet,
      usdcMint,
      daoWallet.publicKey
    );

    // Mint USDC to user
    await mintTo(
      provider.connection,
      user,
      usdcMint,
      userTokenAccount,
      user,
      ESCROW_AMOUNT * 2
    );

    // Derive PDAs
    [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('config')],
      program.programId
    );

    [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow'), Buffer.from(JOB_ID), user.publicKey.toBuffer()],
      program.programId
    );

    [vaultPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), escrowPDA.toBuffer()],
      program.programId
    );
  });

  describe('initialize', () => {
    it('initializes the protocol config', async () => {
      const tx = await program.methods
        .initialize(1000, 500) // 10% protocol, 5% DAO
        .accounts({
          config: configPDA,
          authority: provider.wallet.publicKey,
          protocolWallet: protocolWallet.publicKey,
          daoWallet: daoWallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('Initialize tx:', tx);

      const config = await program.account.config.fetch(configPDA);
      expect(config.protocolFeeBps).to.equal(1000);
      expect(config.daoFeeBps).to.equal(500);
      expect(config.totalEscrows.toNumber()).to.equal(0);
    });
  });

  describe('create_escrow', () => {
    it('creates an escrow with USDC deposit', async () => {
      const userBalanceBefore = await getAccount(provider.connection, userTokenAccount);

      const tx = await program.methods
        .createEscrow(JOB_ID, new anchor.BN(ESCROW_AMOUNT), new anchor.BN(DEADLINE))
        .accounts({
          escrow: escrowPDA,
          escrowVault: vaultPDA,
          config: configPDA,
          user: user.publicKey,
          agent: agent.publicKey,
          userTokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      console.log('Create escrow tx:', tx);

      // Verify escrow state
      const escrow = await program.account.escrow.fetch(escrowPDA);
      expect(escrow.jobId).to.equal(JOB_ID);
      expect(escrow.amount.toNumber()).to.equal(ESCROW_AMOUNT);
      expect(escrow.status).to.deep.equal({ active: {} });

      // Verify USDC transferred to vault
      const vaultBalance = await getAccount(provider.connection, vaultPDA);
      expect(Number(vaultBalance.amount)).to.equal(ESCROW_AMOUNT);

      // Verify user balance decreased
      const userBalanceAfter = await getAccount(provider.connection, userTokenAccount);
      expect(Number(userBalanceBefore.amount) - Number(userBalanceAfter.amount)).to.equal(ESCROW_AMOUNT);

      // Verify config stats updated
      const config = await program.account.config.fetch(configPDA);
      expect(config.totalEscrows.toNumber()).to.equal(1);
      expect(config.totalVolume.toNumber()).to.equal(ESCROW_AMOUNT);
    });
  });

  describe('release_escrow', () => {
    it('releases funds with correct fee split (85/10/5)', async () => {
      const tx = await program.methods
        .releaseEscrow()
        .accounts({
          escrow: escrowPDA,
          escrowVault: vaultPDA,
          config: configPDA,
          user: user.publicKey,
          agentTokenAccount,
          protocolTokenAccount,
          daoTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log('Release escrow tx:', tx);

      // Verify escrow status
      const escrow = await program.account.escrow.fetch(escrowPDA);
      expect(escrow.status).to.deep.equal({ released: {} });

      // Verify fee splits
      const agentBalance = await getAccount(provider.connection, agentTokenAccount);
      const protocolBalance = await getAccount(provider.connection, protocolTokenAccount);
      const daoBalance = await getAccount(provider.connection, daoTokenAccount);

      // 85% to agent = 85,000,000
      expect(Number(agentBalance.amount)).to.equal(85_000_000);

      // 10% to protocol = 10,000,000
      expect(Number(protocolBalance.amount)).to.equal(10_000_000);

      // 5% to DAO = 5,000,000
      expect(Number(daoBalance.amount)).to.equal(5_000_000);

      // Vault should be empty
      const vaultBalance = await getAccount(provider.connection, vaultPDA);
      expect(Number(vaultBalance.amount)).to.equal(0);
    });
  });

  describe('dispute flow', () => {
    const DISPUTE_JOB_ID = 'dispute-job-001';
    let disputeEscrowPDA: PublicKey;
    let disputeVaultPDA: PublicKey;

    before(async () => {
      // Create a new escrow for dispute testing
      [disputeEscrowPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), Buffer.from(DISPUTE_JOB_ID), user.publicKey.toBuffer()],
        program.programId
      );

      [disputeVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), disputeEscrowPDA.toBuffer()],
        program.programId
      );

      await program.methods
        .createEscrow(DISPUTE_JOB_ID, new anchor.BN(ESCROW_AMOUNT), new anchor.BN(DEADLINE))
        .accounts({
          escrow: disputeEscrowPDA,
          escrowVault: disputeVaultPDA,
          config: configPDA,
          user: user.publicKey,
          agent: agent.publicKey,
          userTokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
    });

    it('opens a dispute', async () => {
      const tx = await program.methods
        .openDispute('Agent did not deliver work as promised')
        .accounts({
          escrow: disputeEscrowPDA,
          caller: user.publicKey,
        })
        .signers([user])
        .rpc();

      console.log('Open dispute tx:', tx);

      const escrow = await program.account.escrow.fetch(disputeEscrowPDA);
      expect(escrow.status).to.deep.equal({ disputed: {} });
      expect(escrow.disputeReason).to.equal('Agent did not deliver work as promised');
      expect(escrow.disputeOpenedBy.toBase58()).to.equal(user.publicKey.toBase58());
    });

    it('resolves dispute with 50/50 split', async () => {
      // Reset token balances for clean test
      const agentBalanceBefore = await getAccount(provider.connection, agentTokenAccount);
      const userBalanceBefore = await getAccount(provider.connection, userTokenAccount);

      const tx = await program.methods
        .resolveDispute(2) // 50/50 split
        .accounts({
          escrow: disputeEscrowPDA,
          escrowVault: disputeVaultPDA,
          config: configPDA,
          authority: provider.wallet.publicKey,
          userTokenAccount,
          agentTokenAccount,
          protocolTokenAccount,
          daoTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log('Resolve dispute tx:', tx);

      const escrow = await program.account.escrow.fetch(disputeEscrowPDA);
      expect(escrow.status).to.deep.equal({ resolved: {} });
      expect(escrow.disputeWinner).to.equal(2);

      // After fees (15%), remaining is 85M, split 50/50 = 42.5M each
      const agentBalanceAfter = await getAccount(provider.connection, agentTokenAccount);
      const userBalanceAfter = await getAccount(provider.connection, userTokenAccount);

      const agentReceived = Number(agentBalanceAfter.amount) - Number(agentBalanceBefore.amount);
      const userReceived = Number(userBalanceAfter.amount) - Number(userBalanceBefore.amount);

      expect(agentReceived).to.equal(42_500_000);
      expect(userReceived).to.equal(42_500_000);
    });
  });

  describe('cancel_escrow', () => {
    const CANCEL_JOB_ID = 'cancel-job-001';
    let cancelEscrowPDA: PublicKey;
    let cancelVaultPDA: PublicKey;

    before(async () => {
      [cancelEscrowPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('escrow'), Buffer.from(CANCEL_JOB_ID), user.publicKey.toBuffer()],
        program.programId
      );

      [cancelVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), cancelEscrowPDA.toBuffer()],
        program.programId
      );

      // Mint more USDC to user for this test
      await mintTo(
        provider.connection,
        user,
        usdcMint,
        userTokenAccount,
        user,
        ESCROW_AMOUNT
      );

      await program.methods
        .createEscrow(CANCEL_JOB_ID, new anchor.BN(ESCROW_AMOUNT), new anchor.BN(DEADLINE))
        .accounts({
          escrow: cancelEscrowPDA,
          escrowVault: cancelVaultPDA,
          config: configPDA,
          user: user.publicKey,
          agent: agent.publicKey,
          userTokenAccount,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
    });

    it('cancels escrow with full refund', async () => {
      const userBalanceBefore = await getAccount(provider.connection, userTokenAccount);

      const tx = await program.methods
        .cancelEscrow()
        .accounts({
          escrow: cancelEscrowPDA,
          escrowVault: cancelVaultPDA,
          user: user.publicKey,
          userTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log('Cancel escrow tx:', tx);

      const escrow = await program.account.escrow.fetch(cancelEscrowPDA);
      expect(escrow.status).to.deep.equal({ cancelled: {} });

      // User should receive full refund
      const userBalanceAfter = await getAccount(provider.connection, userTokenAccount);
      const refund = Number(userBalanceAfter.amount) - Number(userBalanceBefore.amount);
      expect(refund).to.equal(ESCROW_AMOUNT);
    });
  });
});
