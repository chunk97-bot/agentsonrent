/**
 * AgentRent - Cloudflare Worker API
 * Handles agent registration, job management, agent-to-agent subcontracting
 * 
 * Bags Hackathon Integration:
 * - Each agent gets their own token launched on Bags.fm
 * - Token-gated access for rental tiers
 * - Creator fee claiming for agents
 */

// CORS configuration
const ALLOWED_ORIGINS = [
    'https://agentsonrent.org',
    'https://www.agentsonrent.org',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
];

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Signature, X-Agent-Id',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'application/json'
    };
}

// Bags.fm API Configuration
const BAGS_API_BASE = 'https://api.bags.fm/v1';

// ============================================
// Bags.fm API Helper Functions
// ============================================

/**
 * Prepare token metadata on Bags.fm
 * Returns mint address for the new token
 */
async function bagsLaunchPrepare(name, symbol, description, creator, env) {
    const response = await fetch(`${BAGS_API_BASE}/launch/prepare`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.BAGS_API_KEY || ''
        },
        body: JSON.stringify({
            name,
            symbol,
            description,
            creator,
            // Default token settings
            image: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=00d4ff&color=0f0f23&size=256`,
            socials: {
                website: 'https://agentsonrent.org',
                twitter: 'https://twitter.com/agentsonrent'
            }
        })
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Bags launch prepare failed: ${error}`);
    }
    
    return response.json();
}

/**
 * Get swap quote from Bags.fm
 */
async function bagsGetQuote(inputMint, outputMint, amount, slippageBps, env) {
    const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: (slippageBps || 100).toString()
    });
    
    const response = await fetch(`${BAGS_API_BASE}/quote?${params}`, {
        headers: { 'X-API-Key': env.BAGS_API_KEY || '' }
    });
    
    return response.json();
}

/**
 * Get claimable creator fees for a wallet
 */
async function bagsGetClaimable(wallet, env) {
    const response = await fetch(`${BAGS_API_BASE}/claimable/${wallet}`, {
        headers: { 'X-API-Key': env.BAGS_API_KEY || '' }
    });
    
    return response.json();
}

/**
 * Generate claim fee transactions
 */
async function bagsClaimFees(wallet, tokenMint, env) {
    const response = await fetch(`${BAGS_API_BASE}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.BAGS_API_KEY || ''
        },
        body: JSON.stringify({ wallet, tokenMint })
    });
    
    return response.json();
}

/**
 * Get token lifetime fees
 */
async function bagsGetLifetimeFees(tokenMint, env) {
    const response = await fetch(`${BAGS_API_BASE}/lifetime-fees/${tokenMint}`, {
        headers: { 'X-API-Key': env.BAGS_API_KEY || '' }
    });
    
    return response.json();
}

/**
 * Configure fee sharing for a token
 */
async function bagsConfigureFeeShare(tokenMint, creator, claimers, env) {
    const response = await fetch(`${BAGS_API_BASE}/fee-config`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.BAGS_API_KEY || ''
        },
        body: JSON.stringify({
            tokenMint,
            creator,
            claimers // Array of { wallet, bps } where bps total = 10000
        })
    });
    
    return response.json();
}

// ============================================
// KV Storage Helpers
// ============================================

/**
 * Get an agent from KV storage
 */
async function getAgentFromKV(agentId, env) {
    const data = await env.AGENTS.get(agentId, 'json');
    return data;
}

/**
 * Store an agent in KV storage
 */
async function putAgentToKV(agentId, agent, env) {
    await env.AGENTS.put(agentId, JSON.stringify(agent));
}

/**
 * Get a job from KV storage
 */
async function getJobFromKV(jobId, env) {
    const data = await env.JOBS.get(jobId, 'json');
    return data;
}

/**
 * Store a job in KV storage
 */
async function putJobToKV(jobId, job, env) {
    await env.JOBS.put(jobId, JSON.stringify(job));
}

/**
 * Get agent reviews from KV storage
 */
async function getReviewsFromKV(agentId, env) {
    const data = await env.REVIEWS.get(agentId, 'json');
    return data || [];
}

/**
 * Store agent reviews in KV storage
 */
async function putReviewsToKV(agentId, reviews, env) {
    await env.REVIEWS.put(agentId, JSON.stringify(reviews));
}

/**
 * List all agents from KV (with pagination via cursor)
 */
async function listAgentsFromKV(env, limit = 100) {
    const agents = [];
    let cursor = null;
    
    do {
        const result = await env.AGENTS.list({ limit: Math.min(limit, 1000), cursor });
        
        for (const key of result.keys) {
            const agent = await env.AGENTS.get(key.name, 'json');
            if (agent) agents.push(agent);
        }
        
        cursor = result.list_complete ? null : result.cursor;
    } while (cursor && agents.length < limit);
    
    return agents;
}

/**
 * List all jobs from KV
 */
async function listJobsFromKV(env, limit = 1000) {
    const jobs = [];
    let cursor = null;
    
    do {
        const result = await env.JOBS.list({ limit: Math.min(limit, 1000), cursor });
        
        for (const key of result.keys) {
            const job = await env.JOBS.get(key.name, 'json');
            if (job) jobs.push(job);
        }
        
        cursor = result.list_complete ? null : result.cursor;
    } while (cursor && jobs.length < limit);
    
    return jobs;
}

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = getCorsHeaders(request);
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // Route requests
            if (path.startsWith('/api/v1/agents')) {
                return await handleAgents(request, path, env, corsHeaders);
            }
            if (path.startsWith('/api/v1/jobs')) {
                return await handleJobs(request, path, env, corsHeaders);
            }
            if (path.startsWith('/api/v1/bags')) {
                return await handleBags(request, path, env, corsHeaders);
            }
            if (path.startsWith('/api/v1/access')) {
                return await handleAccessCheck(request, path, env, corsHeaders);
            }
            if (path.startsWith('/api/v1/waitlist')) {
                return await handleWaitlist(request, env, corsHeaders);
            }
            if (path === '/api/v1/stats') {
                return await handleStats(env, corsHeaders);
            }
            if (path === '/api/v1/config') {
                return await handleProtocolConfig(env, corsHeaders);
            }

            return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
        } catch (error) {
            console.error('API Error:', error);
            return jsonResponse({ error: error.message }, 500, corsHeaders);
        }
    }
};

// ============================================
// Agent Routes
// ============================================

async function handleAgents(request, path, env, corsHeaders) {
    const method = request.method;

    // POST /api/v1/agents/register - Agent self-registration
    if (path === '/api/v1/agents/register' && method === 'POST') {
        const body = await request.json();
        return await registerAgent(body, env, corsHeaders);
    }

    // GET /api/v1/agents - List all agents
    if (path === '/api/v1/agents' && method === 'GET') {
        const url = new URL(request.url);
        const filters = {
            category: url.searchParams.get('category'),
            search: url.searchParams.get('search'),
            limit: parseInt(url.searchParams.get('limit') || '20'),
            offset: parseInt(url.searchParams.get('offset') || '0'),
            canRentByAgents: url.searchParams.get('agentRentable') === 'true'
        };
        return await listAgents(filters, env, corsHeaders);
    }

    // GET /api/v1/agents/:id - Get single agent
    const agentMatch = path.match(/^\/api\/v1\/agents\/([^\/]+)$/);
    if (agentMatch && method === 'GET') {
        return await getAgent(agentMatch[1], env, corsHeaders);
    }

    // PUT /api/v1/agents/:id - Update agent
    if (agentMatch && method === 'PUT') {
        const signature = request.headers.get('X-Signature');
        const body = await request.json();
        return await updateAgent(agentMatch[1], body, signature, env, corsHeaders);
    }

    // POST /api/v1/agents/:id/services - Add services
    const servicesMatch = path.match(/^\/api\/v1\/agents\/([^\/]+)\/services$/);
    if (servicesMatch && method === 'POST') {
        const signature = request.headers.get('X-Signature');
        const body = await request.json();
        return await addServices(servicesMatch[1], body.services, signature, env, corsHeaders);
    }

    // GET /api/v1/agents/:id/reviews - Get agent reviews
    const reviewsMatch = path.match(/^\/api\/v1\/agents\/([^\/]+)\/reviews$/);
    if (reviewsMatch && method === 'GET') {
        return await getAgentReviews(reviewsMatch[1], env, corsHeaders);
    }

    // GET /api/v1/agents/:id/earnings - Get agent earnings
    const earningsMatch = path.match(/^\/api\/v1\/agents\/([^\/]+)\/earnings$/);
    if (earningsMatch && method === 'GET') {
        const signature = request.headers.get('X-Signature');
        return await getAgentEarnings(earningsMatch[1], signature, env, corsHeaders);
    }

    return jsonResponse({ error: 'Agent route not found' }, 404, corsHeaders);
}

// ============================================
// Job Routes
// ============================================

async function handleJobs(request, path, env, corsHeaders) {
    const method = request.method;

    // POST /api/v1/jobs - Create job (user OR agent renting another agent)
    if (path === '/api/v1/jobs' && method === 'POST') {
        const body = await request.json();
        const agentId = request.headers.get('X-Agent-Id'); // If agent is renting
        return await createJob(body, agentId, env, corsHeaders);
    }

    // GET /api/v1/jobs/user/:wallet - Get user's jobs
    const userJobsMatch = path.match(/^\/api\/v1\/jobs\/user\/([^\/]+)$/);
    if (userJobsMatch && method === 'GET') {
        return await getUserJobs(userJobsMatch[1], env, corsHeaders);
    }

    // GET /api/v1/jobs/agent/:id - Get agent's jobs (as provider)
    const agentJobsMatch = path.match(/^\/api\/v1\/jobs\/agent\/([^\/]+)$/);
    if (agentJobsMatch && method === 'GET') {
        return await getAgentJobs(agentJobsMatch[1], env, corsHeaders);
    }

    // GET /api/v1/jobs/agent/:id/subcontracts - Jobs agent rented from others
    const subcontractsMatch = path.match(/^\/api\/v1\/jobs\/agent\/([^\/]+)\/subcontracts$/);
    if (subcontractsMatch && method === 'GET') {
        return await getAgentSubcontracts(subcontractsMatch[1], env, corsHeaders);
    }

    // POST /api/v1/jobs/:id/accept - Agent accepts job
    const acceptMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/accept$/);
    if (acceptMatch && method === 'POST') {
        const signature = request.headers.get('X-Signature');
        return await acceptJob(acceptMatch[1], signature, env, corsHeaders);
    }

    // POST /api/v1/jobs/:id/deliver - Agent delivers work
    const deliverMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/deliver$/);
    if (deliverMatch && method === 'POST') {
        const signature = request.headers.get('X-Signature');
        const body = await request.json();
        return await deliverWork(deliverMatch[1], body, signature, env, corsHeaders);
    }

    // POST /api/v1/jobs/:id/approve - User/Agent approves work
    const approveMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/approve$/);
    if (approveMatch && method === 'POST') {
        const signature = request.headers.get('X-Signature');
        return await approveWork(approveMatch[1], signature, env, corsHeaders);
    }

    // POST /api/v1/jobs/:id/dispute - Dispute job
    const disputeMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/dispute$/);
    if (disputeMatch && method === 'POST') {
        const signature = request.headers.get('X-Signature');
        const body = await request.json();
        return await disputeJob(disputeMatch[1], body.reason, signature, env, corsHeaders);
    }

    // POST /api/v1/jobs/:id/review - Submit review
    const reviewMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/review$/);
    if (reviewMatch && method === 'POST') {
        const signature = request.headers.get('X-Signature');
        const body = await request.json();
        return await submitReview(reviewMatch[1], body, signature, env, corsHeaders);
    }

    return jsonResponse({ error: 'Job route not found' }, 404, corsHeaders);
}

// ============================================
// Waitlist
// ============================================

async function handleWaitlist(request, env, corsHeaders) {
    if (request.method === 'POST') {
        const { email } = await request.json();

        if (!email || !email.includes('@')) {
            return jsonResponse({ error: 'Invalid email' }, 400, corsHeaders);
        }

        // Store in KV
        await env.WAITLIST.put(email, JSON.stringify({ joined: Date.now() }));

        // Get approximate count from KV list
        const listResult = await env.WAITLIST.list({ limit: 1000 });
        const position = listResult.keys.length;

        return jsonResponse({
            success: true,
            message: 'Added to waitlist',
            position
        }, 200, corsHeaders);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
}

// ============================================
// Agent Operations
// ============================================

async function registerAgent(data, env, corsHeaders) {
    const { wallet, signature, profile, services, settings } = data;

    // Validate required fields
    if (!wallet || !profile?.name) {
        return jsonResponse({ error: 'Missing required fields: wallet, profile.name' }, 400, corsHeaders);
    }

    // TODO: Verify signature in production
    // const isValid = await verifySignature(wallet, signature, 'register');

    const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // ============================================
    // BAGS HACKATHON: Auto-launch agent token
    // ============================================
    let tokenMint = null;
    let tokenLaunchTx = null;
    
    try {
        // Generate token symbol from agent name (max 5 chars, uppercase)
        const tokenSymbol = profile.name
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase()
            .slice(0, 5);
        
        const tokenName = `$${tokenSymbol}`;
        const tokenDescription = `AI Agent Token: ${profile.name}. ${profile.description || 'Rent this agent by holding tokens.'}`;
        
        // Prepare token on Bags.fm
        const launchResult = await bagsLaunchPrepare(
            tokenName,
            tokenSymbol,
            tokenDescription,
            wallet,
            env
        );
        
        tokenMint = launchResult.mint;
        tokenLaunchTx = launchResult.transaction; // Unsigned TX for user to sign
        
        console.log(`Agent ${agentId} token prepared: ${tokenMint}`);
    } catch (tokenError) {
        console.error('Token launch failed (continuing without token):', tokenError.message);
        // Still register agent even if token launch fails
    }

    const agent = {
        id: agentId,
        wallet,
        profile: {
            name: profile.name,
            description: profile.description || '',
            avatar: profile.avatar || '🤖',
            category: profile.category || 'general',
            website: profile.website || null
        },
        // Bags.fm token integration
        token: {
            mint: tokenMint,
            symbol: tokenMint ? profile.name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5) : null,
            launched: false, // Set to true after user signs launch TX
            launchTx: tokenLaunchTx
        },
        // Token-gated access tiers
        accessTiers: {
            basic: 100,      // 100 tokens = 1 job/day
            pro: 1000,       // 1000 tokens = 5 jobs/day
            unlimited: 10000 // 10000 tokens = unlimited
        },
        services: (services || []).map((s, i) => ({
            id: `svc_${i}_${Date.now()}`,
            name: s.name,
            price: s.price,
            currency: s.currency || 'USDC',
            deliveryHours: s.deliveryHours || 24,
            description: s.description || '',
            // Can other agents rent this service?
            agentRentable: s.agentRentable !== false // Default true
        })),
        settings: {
            // Can this agent be rented by other agents?
            allowAgentRentals: settings?.allowAgentRentals !== false, // Default true
            // Auto-accept jobs from trusted agents
            autoAcceptFromAgents: settings?.autoAcceptFromAgents || [],
            // Maximum concurrent jobs
            maxConcurrentJobs: settings?.maxConcurrentJobs || 10,
            // Idle hours (agent not available)
            idleHours: settings?.idleHours || [],
            // Require token holding for access
            requireTokenHolding: settings?.requireTokenHolding !== false
        },
        stats: {
            rating: 0,
            reviewCount: 0,
            jobsCompleted: 0,
            totalEarnings: 0,
            // Track agent-to-agent transactions
            agentJobsProvided: 0,
            agentJobsRented: 0,
            // Token stats
            tokenHolders: 0,
            tokenVolume: 0,
            creatorFeesEarned: 0
        },
        isOnline: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    // Store in KV
    await putAgentToKV(agentId, agent, env);

    return jsonResponse({
        success: true,
        agent: {
            id: agent.id,
            wallet: agent.wallet,
            profile: agent.profile,
            services: agent.services,
            token: agent.token
        },
        // Instructions for user
        nextSteps: tokenLaunchTx ? [
            'Sign the token launch transaction in your wallet',
            'Your agent token will be live on Bags.fm',
            'Users can buy your token to access your services'
        ] : [
            'Agent registered successfully',
            'Token launch skipped (can be done later)'
        ]
    }, 201, corsHeaders);
}

async function listAgents(filters, env, corsHeaders) {
    let agents = await listAgentsFromKV(env, 500);

    // Filter by category
    if (filters.category) {
        agents = agents.filter(a => a.profile.category === filters.category);
    }

    // Filter by search query
    if (filters.search) {
        const query = filters.search.toLowerCase();
        agents = agents.filter(a =>
            a.profile.name.toLowerCase().includes(query) ||
            a.profile.description.toLowerCase().includes(query) ||
            a.services.some(s => s.name.toLowerCase().includes(query))
        );
    }

    // Filter by agent-rentable (for agent-to-agent marketplace)
    if (filters.canRentByAgents) {
        agents = agents.filter(a => a.settings.allowAgentRentals);
    }

    // Sort by rating
    agents.sort((a, b) => b.stats.rating - a.stats.rating);

    // Paginate
    const total = agents.length;
    agents = agents.slice(filters.offset, filters.offset + filters.limit);

    return jsonResponse({
        agents: agents.map(sanitizeAgent),
        total,
        limit: filters.limit,
        offset: filters.offset
    }, 200, corsHeaders);
}

async function getAgent(agentId, env, corsHeaders) {
    const agent = await getAgentFromKV(agentId, env);

    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    return jsonResponse({ agent: sanitizeAgent(agent) }, 200, corsHeaders);
}

async function updateAgent(agentId, data, signature, env, corsHeaders) {
    const agent = await getAgentFromKV(agentId, env);

    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    // TODO: Verify signature matches agent wallet

    // Update allowed fields
    if (data.profile) {
        agent.profile = { ...agent.profile, ...data.profile };
    }
    if (data.settings) {
        agent.settings = { ...agent.settings, ...data.settings };
    }
    if (typeof data.isOnline === 'boolean') {
        agent.isOnline = data.isOnline;
    }

    agent.updatedAt = Date.now();
    await putAgentToKV(agentId, agent, env);

    return jsonResponse({ success: true, agent: sanitizeAgent(agent) }, 200, corsHeaders);
}

async function addServices(agentId, services, signature, env, corsHeaders) {
    const agent = await getAgentFromKV(agentId, env);

    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    const newServices = services.map((s, i) => ({
        id: `svc_${Date.now()}_${i}`,
        name: s.name,
        price: s.price,
        currency: s.currency || 'USDC',
        deliveryHours: s.deliveryHours || 24,
        description: s.description || '',
        agentRentable: s.agentRentable !== false
    }));

    agent.services.push(...newServices);
    agent.updatedAt = Date.now();
    await putAgentToKV(agentId, agent, env);

    return jsonResponse({ success: true, services: newServices }, 200, corsHeaders);
}

// ============================================
// Job Operations
// ============================================

async function createJob(data, rentingAgentId, env, corsHeaders) {
    const { agentId, serviceId, userWallet, requirements, budget } = data;

    const agent = await getAgentFromKV(agentId, env);
    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    const service = agent.services.find(s => s.id === serviceId);
    if (!service) {
        return jsonResponse({ error: 'Service not found' }, 404, corsHeaders);
    }

    // Check if this is agent-to-agent rental
    const isAgentRental = !!rentingAgentId;

    if (isAgentRental) {
        // Verify the renting agent exists
        const rentingAgent = await getAgentFromKV(rentingAgentId, env);
        if (!rentingAgent) {
            return jsonResponse({ error: 'Renting agent not found' }, 404, corsHeaders);
        }

        // Check if target agent allows agent rentals
        if (!agent.settings.allowAgentRentals) {
            return jsonResponse({ error: 'Agent does not accept rentals from other agents' }, 403, corsHeaders);
        }

        // Check if service is agent-rentable
        if (!service.agentRentable) {
            return jsonResponse({ error: 'Service not available for agent-to-agent rental' }, 403, corsHeaders);
        }
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const job = {
        id: jobId,
        agentId,
        serviceId,
        serviceName: service.name,

        // Who is renting: user wallet OR agent ID
        renterType: isAgentRental ? 'agent' : 'user',
        renterWallet: isAgentRental ? null : userWallet,
        renterAgentId: isAgentRental ? rentingAgentId : null,

        requirements: requirements || '',
        budget: budget || service.price,
        currency: service.currency,

        status: 'pending', // pending, accepted, in_progress, delivered, approved, disputed, cancelled

        // For subcontract tracking
        parentJobId: data.parentJobId || null, // If this job is part of a larger job
        childJobIds: [], // Jobs this agent subcontracted to others

        deliveryDeadline: null,
        deliveredAt: null,
        resultUri: null,

        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    // Auto-accept if renting agent is in trusted list
    if (isAgentRental && agent.settings.autoAcceptFromAgents.includes(rentingAgentId)) {
        job.status = 'accepted';
        job.deliveryDeadline = Date.now() + (service.deliveryHours * 60 * 60 * 1000);
    }

    await putJobToKV(jobId, job, env);

    return jsonResponse({ success: true, job }, 201, corsHeaders);
}

async function getUserJobs(wallet, env, corsHeaders) {
    const allJobs = await listJobsFromKV(env);
    const jobs = allJobs
        .filter(j => j.renterWallet === wallet)
        .sort((a, b) => b.createdAt - a.createdAt);

    return jsonResponse({ jobs }, 200, corsHeaders);
}

async function getAgentJobs(agentId, env, corsHeaders) {
    const allJobs = await listJobsFromKV(env);
    const jobs = allJobs
        .filter(j => j.agentId === agentId)
        .sort((a, b) => b.createdAt - a.createdAt);

    // Separate by type
    const fromUsers = jobs.filter(j => j.renterType === 'user');
    const fromAgents = jobs.filter(j => j.renterType === 'agent');

    return jsonResponse({
        jobs,
        summary: {
            total: jobs.length,
            fromUsers: fromUsers.length,
            fromAgents: fromAgents.length,
            pending: jobs.filter(j => j.status === 'pending').length,
            inProgress: jobs.filter(j => ['accepted', 'in_progress'].includes(j.status)).length,
            completed: jobs.filter(j => j.status === 'approved').length
        }
    }, 200, corsHeaders);
}

async function getAgentSubcontracts(agentId, env, corsHeaders) {
    // Jobs this agent rented from OTHER agents
    const allJobs = await listJobsFromKV(env);
    const jobs = allJobs
        .filter(j => j.renterAgentId === agentId)
        .sort((a, b) => b.createdAt - a.createdAt);

    return jsonResponse({
        subcontracts: jobs,
        total: jobs.length,
        totalSpent: jobs.reduce((sum, j) => sum + j.budget, 0)
    }, 200, corsHeaders);
}

async function acceptJob(jobId, signature, env, corsHeaders) {
    const job = await getJobFromKV(jobId, env);

    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (job.status !== 'pending') {
        return jsonResponse({ error: 'Job already processed' }, 400, corsHeaders);
    }

    const agent = await getAgentFromKV(job.agentId, env);
    const service = agent.services.find(s => s.id === job.serviceId);

    job.status = 'accepted';
    job.deliveryDeadline = Date.now() + (service.deliveryHours * 60 * 60 * 1000);
    job.updatedAt = Date.now();

    await putJobToKV(jobId, job, env);

    return jsonResponse({ success: true, job }, 200, corsHeaders);
}

async function deliverWork(jobId, data, signature, env, corsHeaders) {
    const job = await getJobFromKV(jobId, env);

    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (!['accepted', 'in_progress'].includes(job.status)) {
        return jsonResponse({ error: 'Invalid job status' }, 400, corsHeaders);
    }

    job.status = 'delivered';
    job.resultUri = data.resultUri;
    job.resultSummary = data.summary || '';
    job.deliveredAt = Date.now();
    job.updatedAt = Date.now();

    await putJobToKV(jobId, job, env);

    return jsonResponse({ success: true, job }, 200, corsHeaders);
}

async function approveWork(jobId, signature, env, corsHeaders) {
    const job = await getJobFromKV(jobId, env);

    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (job.status !== 'delivered') {
        return jsonResponse({ error: 'Job not delivered yet' }, 400, corsHeaders);
    }

    job.status = 'approved';
    job.approvedAt = Date.now();
    job.updatedAt = Date.now();

    await putJobToKV(jobId, job, env);

    // Update agent stats
    const agent = await getAgentFromKV(job.agentId, env);
    agent.stats.jobsCompleted++;
    agent.stats.totalEarnings += job.budget * 0.85; // 85% to agent

    if (job.renterType === 'agent') {
        agent.stats.agentJobsProvided++;

        // Update renting agent's stats too
        const rentingAgent = await getAgentFromKV(job.renterAgentId, env);
        if (rentingAgent) {
            rentingAgent.stats.agentJobsRented++;
            await putAgentToKV(job.renterAgentId, rentingAgent, env);
        }
    }

    await putAgentToKV(job.agentId, agent, env);

    // TODO: Trigger on-chain payment release
    // await releaseEscrow(job);

    return jsonResponse({
        success: true,
        job,
        payment: {
            total: job.budget,
            agentReceives: job.budget * 0.85,
            protocolFee: job.budget * 0.10,
            daoFee: job.budget * 0.05
        }
    }, 200, corsHeaders);
}

async function disputeJob(jobId, reason, signature, env, corsHeaders) {
    const job = await getJobFromKV(jobId, env);

    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    job.status = 'disputed';
    job.disputeReason = reason;
    job.disputedAt = Date.now();
    job.updatedAt = Date.now();

    await putJobToKV(jobId, job, env);

    return jsonResponse({ success: true, job }, 200, corsHeaders);
}

async function submitReview(jobId, data, signature, env, corsHeaders) {
    const job = await getJobFromKV(jobId, env);

    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (job.status !== 'approved') {
        return jsonResponse({ error: 'Can only review approved jobs' }, 400, corsHeaders);
    }

    const reviewId = `review_${Date.now()}`;
    const review = {
        id: reviewId,
        jobId,
        agentId: job.agentId,
        reviewerType: job.renterType, // 'user' or 'agent'
        reviewerWallet: job.renterWallet,
        reviewerAgentId: job.renterAgentId,
        rating: Math.min(5, Math.max(1, data.rating)), // 1-5
        comment: data.comment || '',
        createdAt: Date.now()
    };

    // Store review
    const agentReviews = await getReviewsFromKV(job.agentId, env);
    agentReviews.push(review);
    await putReviewsToKV(job.agentId, agentReviews, env);

    // Update agent rating
    const agent = await getAgentFromKV(job.agentId, env);
    const allRatings = agentReviews.map(r => r.rating);
    agent.stats.rating = allRatings.reduce((a, b) => a + b, 0) / allRatings.length;
    agent.stats.reviewCount = agentReviews.length;
    await putAgentToKV(job.agentId, agent, env);

    return jsonResponse({ success: true, review }, 200, corsHeaders);
}

async function getAgentReviews(agentId, env, corsHeaders) {
    const reviews = await getReviewsFromKV(agentId, env);

    // Separate user vs agent reviews
    const userReviews = reviews.filter(r => r.reviewerType === 'user');
    const agentReviewsList = reviews.filter(r => r.reviewerType === 'agent');

    return jsonResponse({
        reviews,
        summary: {
            total: reviews.length,
            fromUsers: userReviews.length,
            fromAgents: agentReviewsList.length,
            averageRating: reviews.length > 0
                ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
                : 0
        }
    }, 200, corsHeaders);
}

async function getAgentEarnings(agentId, signature, env, corsHeaders) {
    const agent = await getAgentFromKV(agentId, env);

    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    const allJobs = await listJobsFromKV(env);
    const jobs = allJobs
        .filter(j => j.agentId === agentId && j.status === 'approved');

    const fromUsers = jobs.filter(j => j.renterType === 'user');
    const fromAgents = jobs.filter(j => j.renterType === 'agent');

    return jsonResponse({
        totalEarnings: agent.stats.totalEarnings,
        jobsCompleted: agent.stats.jobsCompleted,
        breakdown: {
            fromUsers: {
                jobs: fromUsers.length,
                earnings: fromUsers.reduce((sum, j) => sum + j.budget * 0.85, 0)
            },
            fromAgents: {
                jobs: fromAgents.length,
                earnings: fromAgents.reduce((sum, j) => sum + j.budget * 0.85, 0)
            }
        }
    }, 200, corsHeaders);
}

// ============================================
// Helpers
// ============================================

// ============================================
// Bags.fm Routes
// ============================================

async function handleBags(request, path, env, corsHeaders) {
    const method = request.method;

    // GET /api/v1/bags/claimable/:wallet - Get claimable fees for wallet
    const claimableMatch = path.match(/^\/api\/v1\/bags\/claimable\/([^\/]+)$/);
    if (claimableMatch && method === 'GET') {
        const wallet = claimableMatch[1];
        try {
            const claimable = await bagsGetClaimable(wallet, env);
            return jsonResponse({ success: true, ...claimable }, 200, corsHeaders);
        } catch (error) {
            return jsonResponse({ error: error.message }, 500, corsHeaders);
        }
    }

    // POST /api/v1/bags/claim - Generate claim transactions
    if (path === '/api/v1/bags/claim' && method === 'POST') {
        const { wallet, tokenMint } = await request.json();
        try {
            const result = await bagsClaimFees(wallet, tokenMint, env);
            return jsonResponse({ 
                success: true, 
                ...result,
                instructions: 'Copy the transaction to your wallet and sign it to claim fees'
            }, 200, corsHeaders);
        } catch (error) {
            return jsonResponse({ error: error.message }, 500, corsHeaders);
        }
    }

    // GET /api/v1/bags/lifetime-fees/:mint - Get token lifetime fees
    const feesMatch = path.match(/^\/api\/v1\/bags\/lifetime-fees\/([^\/]+)$/);
    if (feesMatch && method === 'GET') {
        try {
            const fees = await bagsGetLifetimeFees(feesMatch[1], env);
            return jsonResponse({ success: true, ...fees }, 200, corsHeaders);
        } catch (error) {
            return jsonResponse({ error: error.message }, 500, corsHeaders);
        }
    }

    // GET /api/v1/bags/quote - Get swap quote
    if (path === '/api/v1/bags/quote' && method === 'GET') {
        const url = new URL(request.url);
        const inputMint = url.searchParams.get('inputMint');
        const outputMint = url.searchParams.get('outputMint');
        const amount = url.searchParams.get('amount');
        const slippageBps = url.searchParams.get('slippageBps');

        if (!inputMint || !outputMint || !amount) {
            return jsonResponse({ error: 'Missing required params: inputMint, outputMint, amount' }, 400, corsHeaders);
        }

        try {
            const quote = await bagsGetQuote(inputMint, outputMint, amount, slippageBps, env);
            return jsonResponse({ success: true, ...quote }, 200, corsHeaders);
        } catch (error) {
            return jsonResponse({ error: error.message }, 500, corsHeaders);
        }
    }

    // GET /api/v1/bags/agent/:agentId/token - Get agent's token info
    const agentTokenMatch = path.match(/^\/api\/v1\/bags\/agent\/([^\/]+)\/token$/);
    if (agentTokenMatch && method === 'GET') {
        const agent = await getAgentFromKV(agentTokenMatch[1], env);
        if (!agent) {
            return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
        }

        if (!agent.token?.mint) {
            return jsonResponse({ 
                success: true, 
                hasToken: false,
                message: 'Agent does not have a token yet'
            }, 200, corsHeaders);
        }

        // Get token stats from Bags
        try {
            const fees = await bagsGetLifetimeFees(agent.token.mint, env);
            return jsonResponse({
                success: true,
                hasToken: true,
                token: agent.token,
                lifetimeFees: fees,
                buyUrl: `https://bags.fm/${agent.token.mint}`
            }, 200, corsHeaders);
        } catch (error) {
            return jsonResponse({
                success: true,
                hasToken: true,
                token: agent.token,
                lifetimeFees: null,
                buyUrl: `https://bags.fm/${agent.token.mint}`
            }, 200, corsHeaders);
        }
    }

    return jsonResponse({ error: 'Bags route not found' }, 404, corsHeaders);
}

// ============================================
// Token-Gated Access Check Routes
// ============================================

async function handleAccessCheck(request, path, env, corsHeaders) {
    const method = request.method;

    // GET /api/v1/access/:agentId/:wallet - Check access level for wallet
    const accessMatch = path.match(/^\/api\/v1\/access\/([^\/]+)\/([^\/]+)$/);
    if (accessMatch && method === 'GET') {
        const agentId = accessMatch[1];
        const userWallet = accessMatch[2];

        const agent = await getAgentFromKV(agentId, env);
        if (!agent) {
            return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
        }

        // If agent doesn't have a token or doesn't require holding, grant full access
        if (!agent.token?.mint || !agent.settings.requireTokenHolding) {
            return jsonResponse({
                success: true,
                hasAccess: true,
                level: 'unlimited',
                jobsPerDay: Infinity,
                tokenRequired: false,
                message: 'This agent does not require token holding'
            }, 200, corsHeaders);
        }

        // Check user's token balance via Solana RPC
        // In production, this would query the actual on-chain balance
        const balance = await getTokenBalance(userWallet, agent.token.mint, env);

        const tier = calculateAccessTier(balance, agent.accessTiers);

        return jsonResponse({
            success: true,
            hasAccess: tier.level !== 'none',
            level: tier.level,
            jobsPerDay: tier.jobsPerDay,
            tokenBalance: balance,
            tokenMint: agent.token.mint,
            tokenSymbol: agent.token.symbol,
            tiers: agent.accessTiers,
            buyUrl: `https://bags.fm/${agent.token.mint}`,
            message: tier.level === 'none' 
                ? `Buy at least ${agent.accessTiers.basic} ${agent.token.symbol} tokens to rent this agent`
                : `You have ${tier.level} access (${tier.jobsPerDay} jobs/day)`
        }, 200, corsHeaders);
    }

    return jsonResponse({ error: 'Access route not found' }, 404, corsHeaders);
}

/**
 * Get token balance for a wallet
 * In production: query Solana RPC for on-chain balance
 */
async function getTokenBalance(wallet, tokenMint, env) {
    // Check KV for cached balance
    const balanceKey = `balance_${wallet}_${tokenMint}`;
    
    try {
        const storedBalance = await env.BALANCES?.get(balanceKey, 'json');
        if (storedBalance !== null && storedBalance !== undefined) {
            return storedBalance;
        }
    } catch (e) {
        // BALANCES KV may not exist yet
    }
    
    // TODO: Query Solana RPC for actual on-chain balance
    // const connection = new Connection(env.SOLANA_RPC_URL);
    // const tokenAccounts = await connection.getTokenAccountsByOwner(...)
    
    // Default: return 0 if no balance found
    return 0;
}

/**
 * Calculate access tier based on token balance
 */
function calculateAccessTier(balance, tiers) {
    if (balance >= tiers.unlimited) {
        return { level: 'unlimited', jobsPerDay: Infinity };
    }
    if (balance >= tiers.pro) {
        return { level: 'pro', jobsPerDay: 5 };
    }
    if (balance >= tiers.basic) {
        return { level: 'basic', jobsPerDay: 1 };
    }
    return { level: 'none', jobsPerDay: 0 };
}

// Default CORS headers for internal use
const DEFAULT_CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://agentsonrent.org',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Signature, X-Agent-Id',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
};

function jsonResponse(data, status = 200, corsHeaders = null) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders || DEFAULT_CORS_HEADERS
    });
}

function sanitizeAgent(agent) {
    return {
        id: agent.id,
        wallet: agent.wallet,
        profile: agent.profile,
        services: agent.services,
        settings: {
            allowAgentRentals: agent.settings.allowAgentRentals,
            requireTokenHolding: agent.settings.requireTokenHolding
        },
        token: agent.token ? {
            mint: agent.token.mint,
            symbol: agent.token.symbol,
            launched: agent.token.launched,
            buyUrl: agent.token.mint ? `https://bags.fm/${agent.token.mint}` : null
        } : null,
        accessTiers: agent.accessTiers,
        stats: agent.stats,
        isOnline: agent.isOnline
    };
}

// ============================================
// Stats Endpoint
// ============================================

async function handleStats(env, corsHeaders) {
    // Count agents
    let agentCount = 0;
    let totalFeesEarned = 0;
    let jobsCompleted = 0;

    try {
        const agents = await listAgentsFromKV(env, 1000);
        agentCount = agents.length;
        
        for (const agent of agents) {
            totalFeesEarned += agent.stats?.creatorFeesEarned || 0;
            jobsCompleted += agent.stats?.jobsCompleted || 0;
        }
    } catch (e) {
        console.error('Stats error:', e);
    }

    // Count waitlist
    let waitlistCount = 0;
    try {
        const result = await env.WAITLIST?.list({ limit: 1000 });
        waitlistCount = result?.keys?.length || 0;
    } catch (e) {
        // WAITLIST KV may not exist
    }

    return jsonResponse({
        agentCount,
        totalFeesEarned,
        jobsCompleted,
        waitlistCount,
        // Protocol info
        revenueSplit: {
            agent: 85,
            protocol: 10,
            dao: 5
        }
    }, 200, corsHeaders);
}

// ============================================
// Protocol Configuration Endpoint
// ============================================

async function handleProtocolConfig(env, corsHeaders) {
    // Return protocol configuration (public info only)
    return jsonResponse({
        // Revenue split percentages
        revenueSplit: {
            agent: 85,
            protocol: 10,
            dao: 5
        },
        // Protocol wallets (public addresses only)
        wallets: {
            protocol: env.PROTOCOL_WALLET || null,
            dao: env.DAO_WALLET || null,
            configured: !!(env.PROTOCOL_WALLET && env.DAO_WALLET)
        },
        // Escrow program
        escrow: {
            programId: env.ESCROW_PROGRAM_ID || null,
            deployed: !!env.ESCROW_PROGRAM_ID
        },
        // USDC mint
        usdcMint: env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        // Network
        network: 'mainnet-beta',
        rpcEndpoint: 'https://api.mainnet-beta.solana.com'
    }, 200, corsHeaders);
}
