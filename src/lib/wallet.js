/**
 * AgentRent - Solana Wallet Adapter
 * Handles Phantom, Solflare, Backpack wallet connections
 */

export class WalletAdapter {
    constructor() {
        this.provider = null;
        this.publicKey = null;
        this.walletType = null;
    }

    /**
     * Connect to a wallet
     * @param {string} type - 'phantom' | 'solflare' | 'backpack'
     * @returns {Promise<string>} - Public key address
     */
    async connect(type) {
        try {
            const provider = this.getProvider(type);

            if (!provider) {
                throw new Error(`${type} wallet not installed. Please install it first.`);
            }

            // Request connection
            const response = await provider.connect();

            this.provider = provider;
            this.publicKey = response.publicKey;
            this.walletType = type;

            // Store in localStorage for reconnection
            localStorage.setItem('agentrent_wallet', type);

            // Listen for disconnect
            provider.on('disconnect', () => {
                this.handleDisconnect();
            });

            // Listen for account change
            provider.on('accountChanged', (publicKey) => {
                if (publicKey) {
                    this.publicKey = publicKey;
                } else {
                    this.handleDisconnect();
                }
            });

            return this.publicKey.toString();
        } catch (error) {
            console.error('Wallet connection error:', error);
            throw error;
        }
    }

    /**
     * Get wallet provider
     * @param {string} type - Wallet type
     * @returns {Object|null} - Provider or null
     */
    getProvider(type) {
        switch (type) {
            case 'phantom':
                return window.phantom?.solana || window.solana;
            case 'solflare':
                return window.solflare;
            case 'backpack':
                return window.backpack;
            default:
                return null;
        }
    }

    /**
     * Check for existing connection
     * @returns {Promise<string|null>} - Public key or null
     */
    async checkConnection() {
        const savedWallet = localStorage.getItem('agentrent_wallet');

        if (!savedWallet) return null;

        const provider = this.getProvider(savedWallet);

        if (!provider) return null;

        // Check if already connected
        if (provider.isConnected && provider.publicKey) {
            this.provider = provider;
            this.publicKey = provider.publicKey;
            this.walletType = savedWallet;
            return this.publicKey.toString();
        }

        // Try to reconnect silently
        try {
            const response = await provider.connect({ onlyIfTrusted: true });
            this.provider = provider;
            this.publicKey = response.publicKey;
            this.walletType = savedWallet;
            return this.publicKey.toString();
        } catch {
            // Not connected, clear storage
            localStorage.removeItem('agentrent_wallet');
            return null;
        }
    }

    /**
     * Disconnect wallet
     */
    async disconnect() {
        if (this.provider && this.provider.disconnect) {
            await this.provider.disconnect();
        }
        this.handleDisconnect();
    }

    /**
     * Handle disconnect event
     */
    handleDisconnect() {
        this.provider = null;
        this.publicKey = null;
        this.walletType = null;
        localStorage.removeItem('agentrent_wallet');
    }

    /**
     * Sign a message
     * @param {string} message - Message to sign
     * @returns {Promise<Uint8Array>} - Signature
     */
    async signMessage(message) {
        if (!this.provider) {
            throw new Error('Wallet not connected');
        }

        const encodedMessage = new TextEncoder().encode(message);
        const { signature } = await this.provider.signMessage(encodedMessage, 'utf8');
        return signature;
    }

    /**
     * Sign and send a transaction
     * @param {Transaction} transaction - Solana transaction
     * @returns {Promise<string>} - Transaction signature
     */
    async signAndSendTransaction(transaction) {
        if (!this.provider) {
            throw new Error('Wallet not connected');
        }

        const { signature } = await this.provider.signAndSendTransaction(transaction);
        return signature;
    }

    /**
     * Get current public key as string
     * @returns {string|null}
     */
    getPublicKey() {
        return this.publicKey ? this.publicKey.toString() : null;
    }

    /**
     * Check if wallet is connected
     * @returns {boolean}
     */
    isConnected() {
        return !!this.publicKey;
    }
}

// Export singleton for convenience
export const wallet = new WalletAdapter();
