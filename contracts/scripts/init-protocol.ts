/**
 * AgentRent Escrow - Protocol Initialization Script
 * 
 * This script initializes the escrow protocol with:
 * - Protocol wallet (receives 10% fees)
 * - DAO wallet (receives 5% fees)
 * - Fee configuration
 * 
 * Usage: npx ts-node scripts/init-protocol.ts
 */

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// Configuration
const PROTOCOL_WALLET = new PublicKey('9xRiDJB5cw5JXvYQWyKaJQeC2WkaDBVejSb3uLoqtonF');
const DAO_WALLET = new PublicKey('9wJuAZgVLyV1wk9nozqaeaC9yB9AHppVQNA17HGg9Lro');
const PROTOCOL_FEE_BPS = 1000;  // 10%
const DAO_FEE_BPS = 500;        // 5%

// Network config
const NETWORK = process.env.NETWORK || 'devnet';
const RPC_URL = NETWORK === 'mainnet' 
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';

async function main() {
    console.log('=== AgentRent Escrow Protocol Initialization ===');
    console.log(`Network: ${NETWORK}`);
    console.log(`RPC: ${RPC_URL}`);
    console.log(`Protocol Wallet: ${PROTOCOL_WALLET.toBase58()}`);
    console.log(`DAO Wallet: ${DAO_WALLET.toBase58()}`);
    console.log(`Protocol Fee: ${PROTOCOL_FEE_BPS / 100}%`);
    console.log(`DAO Fee: ${DAO_FEE_BPS / 100}%`);
    console.log('');

    // Load wallet
    const walletPath = process.env.WALLET_PATH || 
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'solana', 'id.json');
    
    if (!fs.existsSync(walletPath)) {
        console.error(`Wallet not found at: ${walletPath}`);
        console.error('Run: solana-keygen new --outfile ~/.config/solana/id.json');
        process.exit(1);
    }

    const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
    );
    console.log(`Authority: ${walletKeypair.publicKey.toBase58()}`);

    // Connect
    const connection = new Connection(RPC_URL, 'confirmed');
    const wallet = new anchor.Wallet(walletKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        preflightCommitment: 'confirmed',
    });
    anchor.setProvider(provider);

    // Load IDL
    const idlPath = path.join(__dirname, '..', 'target', 'idl', 'agentrent_escrow.json');
    if (!fs.existsSync(idlPath)) {
        console.error('IDL not found. Run: anchor build');
        process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

    // Get program ID from keypair
    const programKeypairPath = path.join(__dirname, '..', 'target', 'deploy', 'agentrent_escrow-keypair.json');
    const programKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(programKeypairPath, 'utf-8')))
    );
    const programId = programKeypair.publicKey;
    console.log(`Program ID: ${programId.toBase58()}`);

    // Create program
    const program = new Program(idl, programId, provider);

    // Derive Config PDA
    const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        programId
    );
    console.log(`Config PDA: ${configPda.toBase58()}`);

    // Check if already initialized
    try {
        const existingConfig = await program.account.config.fetch(configPda);
        console.log('');
        console.log('Protocol already initialized!');
        console.log(`Authority: ${existingConfig.authority.toBase58()}`);
        console.log(`Protocol Wallet: ${existingConfig.protocolWallet.toBase58()}`);
        console.log(`DAO Wallet: ${existingConfig.daoWallet.toBase58()}`);
        console.log(`Protocol Fee: ${existingConfig.protocolFeeBps / 100}%`);
        console.log(`DAO Fee: ${existingConfig.daoFeeBps / 100}%`);
        console.log(`Total Escrows: ${existingConfig.totalEscrows.toString()}`);
        console.log(`Total Volume: ${existingConfig.totalVolume.toString()}`);
        return;
    } catch (e) {
        // Not initialized yet, continue
    }

    // Initialize
    console.log('');
    console.log('Initializing protocol...');

    const tx = await program.methods
        .initialize(PROTOCOL_FEE_BPS, DAO_FEE_BPS)
        .accounts({
            authority: walletKeypair.publicKey,
            config: configPda,
            protocolWallet: PROTOCOL_WALLET,
            daoWallet: DAO_WALLET,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

    console.log('');
    console.log('Protocol initialized successfully!');
    console.log(`Transaction: ${tx}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${tx}?cluster=${NETWORK}`);

    // Verify
    const config = await program.account.config.fetch(configPda);
    console.log('');
    console.log('Verified config:');
    console.log(`Authority: ${config.authority.toBase58()}`);
    console.log(`Protocol Wallet: ${config.protocolWallet.toBase58()}`);
    console.log(`DAO Wallet: ${config.daoWallet.toBase58()}`);
}

main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
});
