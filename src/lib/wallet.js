/**
 * AgentRent - Solana Wallet Adapter
 * Handles Phantom, Solflare, Backpack wallet connections
 * 
 * SECURITY NOTES:
 * - Private keys NEVER leave the wallet extension
 * - We only receive the PUBLIC key from the wallet
 * - All signing happens inside the wallet extension
 * - No wallet secrets are stored in browser storage
 */

// Connection configuration
const CONNECTION_TIMEOUT = 30000; // 30 seconds
const RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

export class WalletAdapter {
    constructor() {
        this.provider = null;
        this.publicKey = null;
        this.walletType = null;
        this._listeners = new Map();
        this._eventHandlers = {};
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
                const installUrls = {
                    phantom: 'https://phantom.app/',
                    solflare: 'https://solflare.com/',
                    backpack: 'https://backpack.app/'
                };
                throw new Error(`${type} wallet not installed. Install at: ${installUrls[type]}`);
            }

            // Request connection with timeout
            const connectionPromise = provider.connect();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection timeout. Please try again.')), CONNECTION_TIMEOUT);
            });

            const response = await Promise.race([connectionPromise, timeoutPromise]);

            if (!response.publicKey) {
                throw new Error('No public key received from wallet');
            }

            this.provider = provider;
            this.publicKey = response.publicKey;
            this.walletType = type;

            // Store ONLY wallet type (not any keys!)
            localStorage.setItem('agentrent_wallet_type', type);

            // Setup event listeners
            this._setupListeners(provider);

            return this.publicKey.toString();
        } catch (error) {
            console.error('Wallet connection error:', error);
            
            // Clean up on error
            this._cleanup();
            
            // Provide user-friendly error messages
            if (error.code === 4001) {
                throw new Error('Connection rejected by user');
            } else if (error.message?.includes('already pending')) {
                throw new Error('Connection already in progress. Check your wallet.');
            }
            throw error;
        }
    }

    /**
     * Setup wallet event listeners
     * @private
     */
    _setupListeners(provider) {
        // Remove old listeners first
        this._removeListeners();

        const disconnectHandler = () => {
            this._handleDisconnect();
        };

        const accountChangeHandler = (publicKey) => {
            if (publicKey) {
                this.publicKey = publicKey;
                this._emit('accountChanged', publicKey.toString());
            } else {
                this._handleDisconnect();
            }
        };

        provider.on('disconnect', disconnectHandler);
        provider.on('accountChanged', accountChangeHandler);

        this._listeners.set('disconnect', disconnectHandler);
        this._listeners.set('accountChanged', accountChangeHandler);
    }

    /**
     * Remove event listeners
     * @private
     */
    _removeListeners() {
        if (this.provider) {
            this._listeners.forEach((handler, event) => {
                try {
                    this.provider.off?.(event, handler);
                    this.provider.removeListener?.(event, handler);
                } catch (e) {
                    // Ignore removal errors
                }
            });
        }
        this._listeners.clear();
    }

    /**
     * Get wallet provider
     * @param {string} type - Wallet type
     * @returns {Object|null} - Provider or null
     */
    getProvider(type) {
        switch (type) {
            case 'phantom':
                // Phantom can inject as window.phantom.solana or window.solana
                if (window.phantom?.solana?.isPhantom) {
                    return window.phantom.solana;
                }
                if (window.solana?.isPhantom) {
                    return window.solana;
                }
                return null;
            case 'solflare':
                if (window.solflare?.isSolflare) {
                    return window.solflare;
                }
                return null;
            case 'backpack':
                if (window.backpack?.isBackpack) {
                    return window.backpack;
                }
                return null;
            default:
                return null;
        }
    }

    /**
     * Check for existing connection (auto-reconnect)
     * @returns {Promise<string|null>} - Public key or null
     */
    async checkConnection() {
        const savedWallet = localStorage.getItem('agentrent_wallet_type');

        if (!savedWallet) return null;

        const provider = this.getProvider(savedWallet);
        if (!provider) return null;

        // Check if already connected
        if (provider.isConnected && provider.publicKey) {
            this.provider = provider;
            this.publicKey = provider.publicKey;
            this.walletType = savedWallet;
            this._setupListeners(provider);
            return this.publicKey.toString();
        }

        // Try to reconnect silently (only if previously trusted)
        try {
            const response = await provider.connect({ onlyIfTrusted: true });
            if (response.publicKey) {
                this.provider = provider;
                this.publicKey = response.publicKey;
                this.walletType = savedWallet;
                this._setupListeners(provider);
                return this.publicKey.toString();
            }
        } catch {
            // Not connected or not trusted, clear storage
            localStorage.removeItem('agentrent_wallet_type');
        }

        return null;
    }

    /**
     * Disconnect wallet
     */
    async disconnect() {
        try {
            if (this.provider?.disconnect) {
                await this.provider.disconnect();
            }
        } catch (e) {
            console.warn('Disconnect error (non-critical):', e);
        } finally {
            this._handleDisconnect();
        }
    }

    /**
     * Handle disconnect event
     * @private
     */
    _handleDisconnect() {
        this._cleanup();
        this._emit('disconnect');
    }

    /**
     * Cleanup state
     * @private
     */
    _cleanup() {
        this._removeListeners();
        this.provider = null;
        this.publicKey = null;
        this.walletType = null;
        localStorage.removeItem('agentrent_wallet_type');
    }

    /**
     * Sign a message (for authentication)
     * SECURITY: Message is signed inside wallet extension
     * We never have access to private keys
     * @param {string} message - Message to sign
     * @returns {Promise<{signature: Uint8Array, message: Uint8Array}>}
     */
    async signMessage(message) {
        if (!this.provider) {
            throw new Error('Wallet not connected');
        }

        const encodedMessage = new TextEncoder().encode(message);
        
        try {
            const result = await this.provider.signMessage(encodedMessage, 'utf8');
            return {
                signature: result.signature,
                message: encodedMessage
            };
        } catch (error) {
            if (error.code === 4001) {
                throw new Error('Message signing rejected by user');
            }
            throw error;
        }
    }

    /**
     * Check SOL balance for transaction fees
     * @returns {Promise<number>} - Balance in SOL
     */
    async getBalance() {
        if (!this.publicKey) {
            throw new Error('Wallet not connected');
        }

        try {
            const response = await fetch(RPC_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getBalance',
                    params: [this.publicKey.toString()]
                })
            });

            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message);
            }

            // Convert lamports to SOL
            return data.result.value / 1e9;
        } catch (error) {
            console.error('Balance check failed:', error);
            throw new Error('Failed to check balance. Please try again.');
        }
    }

    /**
     * Check if user has enough SOL for transaction fees
     * @param {number} minRequired - Minimum SOL required (default 0.01)
     * @returns {Promise<{hasEnough: boolean, balance: number}>}
     */
    async checkSufficientBalance(minRequired = 0.01) {
        const balance = await this.getBalance();
        return {
            hasEnough: balance >= minRequired,
            balance: balance
        };
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
        return !!this.publicKey && !!this.provider;
    }

    /**
     * Get wallet type
     * @returns {string|null}
     */
    getWalletType() {
        return this.walletType;
    }

    // Simple event emitter
    on(event, handler) {
        if (!this._eventHandlers[event]) {
            this._eventHandlers[event] = [];
        }
        this._eventHandlers[event].push(handler);
    }

    off(event, handler) {
        if (this._eventHandlers[event]) {
            this._eventHandlers[event] = this._eventHandlers[event].filter(h => h !== handler);
        }
    }

    _emit(event, data) {
        if (this._eventHandlers[event]) {
            this._eventHandlers[event].forEach(handler => handler(data));
        }
    }
}

// Export singleton for convenience
export const wallet = new WalletAdapter();
