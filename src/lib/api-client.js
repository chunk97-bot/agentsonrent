/**
 * AgentRent - API Client
 * Handles all communication with the backend
 * Supports: User → Agent AND Agent → Agent rentals
 */

const API_BASE = '/api/v1';

export class ApiClient {
    constructor() {
        this.baseUrl = API_BASE;
        this.currentAgentId = localStorage.getItem('agentrent_current_agent');
    }

    /**
     * Set the current agent ID (when operating as an agent)
     */
    setCurrentAgent(agentId) {
        this.currentAgentId = agentId;
        if (agentId) {
            localStorage.setItem('agentrent_current_agent', agentId);
        } else {
            localStorage.removeItem('agentrent_current_agent');
        }
    }

    /**
     * Check if current session is operating as an agent
     */
    isAgent() {
        return !!this.currentAgentId;
    }

    /**
     * Make API request
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        if (options.body) {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'API request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    // ============================================
    // Waitlist
    // ============================================

    async joinWaitlist(email) {
        return this.request('/waitlist', {
            method: 'POST',
            body: { email }
        });
    }

    // ============================================
    // Agents
    // ============================================

    /**
     * Get all agents
     * @param {Object} filters - { category, search, limit, offset, agentRentable }
     */
    async getAgents(filters = {}) {
        const params = new URLSearchParams(filters);
        return this.request(`/agents?${params}`);
    }

    /**
     * Get agents available for agent-to-agent rental
     */
    async getAgentRentableAgents(filters = {}) {
        return this.getAgents({ ...filters, agentRentable: 'true' });
    }

    /**
     * Get single agent by ID
     */
    async getAgent(agentId) {
        return this.request(`/agents/${agentId}`);
    }

    /**
     * Register a new agent
     */
    async registerAgent(data) {
        return this.request('/agents/register', {
            method: 'POST',
            body: data
        });
    }

    /**
     * Update agent profile
     */
    async updateAgent(agentId, data, signature) {
        return this.request(`/agents/${agentId}`, {
            method: 'PUT',
            headers: {
                'X-Signature': signature
            },
            body: data
        });
    }

    // ============================================
    // Services
    // ============================================

    /**
     * Add services to agent
     */
    async addServices(agentId, services, signature) {
        return this.request(`/agents/${agentId}/services`, {
            method: 'POST',
            headers: {
                'X-Signature': signature
            },
            body: { services }
        });
    }

    /**
     * Update service
     */
    async updateService(agentId, serviceId, data, signature) {
        return this.request(`/agents/${agentId}/services/${serviceId}`, {
            method: 'PUT',
            headers: {
                'X-Signature': signature
            },
            body: data
        });
    }

    /**
     * Delete service
     */
    async deleteService(agentId, serviceId, signature) {
        return this.request(`/agents/${agentId}/services/${serviceId}`, {
            method: 'DELETE',
            headers: {
                'X-Signature': signature
            }
        });
    }

    // ============================================
    // Jobs
    // ============================================

    /**
     * Create a new job (rent agent) - can be user OR agent
     * @param {Object} data - { agentId, serviceId, userWallet, requirements, budget, parentJobId }
     * @param {boolean} asAgent - If true, rent as an agent (agent-to-agent)
     */
    async createJob(data, asAgent = false) {
        const headers = {};

        // If renting as an agent, include our agent ID
        if (asAgent && this.currentAgentId) {
            headers['X-Agent-Id'] = this.currentAgentId;
        }

        return this.request('/jobs', {
            method: 'POST',
            headers,
            body: data
        });
    }

    /**
     * Agent subcontracts another agent (alias for createJob with asAgent=true)
     */
    async subcontractAgent(agentId, serviceId, requirements, budget, parentJobId = null) {
        if (!this.currentAgentId) {
            throw new Error('Must be operating as an agent to subcontract');
        }

        return this.createJob({
            agentId,
            serviceId,
            requirements,
            budget,
            parentJobId
        }, true);
    }

    /**
     * Get user's jobs
     */
    async getUserJobs(wallet) {
        return this.request(`/jobs/user/${wallet}`);
    }

    /**
     * Get agent's jobs (jobs they're hired for)
     */
    async getAgentJobs(agentId) {
        return this.request(`/jobs/agent/${agentId}`);
    }

    /**
     * Get agent's subcontracts (jobs they've hired OTHER agents for)
     */
    async getAgentSubcontracts(agentId) {
        return this.request(`/jobs/agent/${agentId}/subcontracts`);
    }

    /**
     * Accept a job (agent)
     */
    async acceptJob(jobId, signature) {
        return this.request(`/jobs/${jobId}/accept`, {
            method: 'POST',
            headers: {
                'X-Signature': signature
            }
        });
    }

    /**
     * Deliver work (agent)
     */
    async deliverWork(jobId, data, signature) {
        return this.request(`/jobs/${jobId}/deliver`, {
            method: 'POST',
            headers: {
                'X-Signature': signature
            },
            body: data
        });
    }

    /**
     * Approve work (user)
     */
    async approveWork(jobId, signature) {
        return this.request(`/jobs/${jobId}/approve`, {
            method: 'POST',
            headers: {
                'X-Signature': signature
            }
        });
    }

    /**
     * Dispute job
     */
    async disputeJob(jobId, reason, signature) {
        return this.request(`/jobs/${jobId}/dispute`, {
            method: 'POST',
            headers: {
                'X-Signature': signature
            },
            body: { reason }
        });
    }

    // ============================================
    // Reviews
    // ============================================

    /**
     * Submit review
     */
    async submitReview(jobId, data, signature) {
        return this.request(`/jobs/${jobId}/review`, {
            method: 'POST',
            headers: {
                'X-Signature': signature
            },
            body: data
        });
    }

    /**
     * Get agent reviews
     */
    async getAgentReviews(agentId) {
        return this.request(`/agents/${agentId}/reviews`);
    }

    // ============================================
    // Earnings
    // ============================================

    /**
     * Get agent earnings
     */
    async getAgentEarnings(agentId, signature) {
        return this.request(`/agents/${agentId}/earnings`, {
            headers: {
                'X-Signature': signature
            }
        });
    }

    // ============================================
    // Bags.fm Integration (Token & Fees)
    // ============================================

    /**
     * Get claimable creator fees for a wallet
     * @param {string} wallet - Solana wallet address
     */
    async getClaimableFees(wallet) {
        return this.request(`/bags/claimable/${wallet}`);
    }

    /**
     * Generate claim fee transactions
     * @param {string} wallet - Wallet to receive fees
     * @param {string} tokenMint - Optional: specific token mint
     */
    async claimFees(wallet, tokenMint = null) {
        return this.request('/bags/claim', {
            method: 'POST',
            body: { wallet, tokenMint }
        });
    }

    /**
     * Get agent's token info and stats
     * @param {string} agentId - Agent ID
     */
    async getAgentToken(agentId) {
        return this.request(`/bags/agent/${agentId}/token`);
    }

    /**
     * Get lifetime fees for a token
     * @param {string} tokenMint - Token mint address
     */
    async getTokenLifetimeFees(tokenMint) {
        return this.request(`/bags/lifetime-fees/${tokenMint}`);
    }

    /**
     * Get swap quote from Bags.fm
     * @param {string} inputMint - Input token mint (e.g., SOL)
     * @param {string} outputMint - Output token mint (agent token)
     * @param {number} amount - Amount in lamports/smallest unit
     * @param {number} slippageBps - Slippage in basis points (default 100 = 1%)
     */
    async getSwapQuote(inputMint, outputMint, amount, slippageBps = 100) {
        const params = new URLSearchParams({
            inputMint,
            outputMint,
            amount: amount.toString(),
            slippageBps: slippageBps.toString()
        });
        return this.request(`/bags/quote?${params}`);
    }

    // ============================================
    // Token-Gated Access
    // ============================================

    /**
     * Check access level for a user wallet with an agent
     * @param {string} agentId - Agent to check access for
     * @param {string} userWallet - User's wallet address
     */
    async checkAccess(agentId, userWallet) {
        return this.request(`/access/${agentId}/${userWallet}`);
    }

    /**
     * Check if user can rent agent (convenience method)
     * @returns {boolean} - true if user has any access level
     */
    async canRentAgent(agentId, userWallet) {
        const result = await this.checkAccess(agentId, userWallet);
        return result.hasAccess;
    }
}

// Export singleton
export const api = new ApiClient();
