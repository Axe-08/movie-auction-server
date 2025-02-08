import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import { networkInterfaces } from 'os';

// Define types for our application
interface ConnectedClient {
    productionHouseId?: number;
    connectionTime: Date;
    lastActivity: Date;
}

interface ProductionHouse {
    id: number;
    name: string;
    budget?: number;  // Optional since not all queries return budget
    access_code?: string;  // Optional since not all queries return access code
}

interface ProductionHouseWithBudget {
    id: number;
    name: string;
    budget: number;
}

interface CrewMember {
    id: number;
    name: string;
    status: string;
}

interface VerifyResponse {
    success: boolean;
    error?: string;
}

interface SaleRequest {
    crewMemberId: number;
    productionHouseId: number;
    purchasePrice: number;
}

interface SaleResult {
    success: boolean;
    error?: string;
    data?: {
        crewMemberId: number;
        productionHouseId: number;
        purchasePrice: number;
    };
}

interface AdminAuthRequest {
    accessCode: string;
}

function debugLog(message: string) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}



// Create Express application and HTTP server
const app = express();
const httpServer = createServer(app);

// Start the server
const PORT: number = Number(process.env.PORT) || 3001;
// We need to properly type the host
const HOST = '0.0.0.0';

// The listen method needs proper typing
httpServer.listen(PORT, () => {
    console.log(`Server started at ${new Date().toISOString()}`);
    console.log(`Listening on port ${PORT}`);
    // Log all available network interfaces
    const nets = networkInterfaces();
    Object.keys(nets).forEach((name) => {
        const net = nets[name];
        if (net) {
            net.forEach((netInterface) => {
                if (netInterface.family === 'IPv4') {
                    console.log(`Interface ${name}: ${netInterface.address}`);
                }
            });
        }
    });
})

// Initialize database connection
const db = new sqlite3.Database('auction.db');

// Enable foreign key constraints
db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
});

// Set up middleware
const corsOptions = {
    origin: function (origin: any, callback: any) {
        console.log('Request origin:', origin);
        // Allow requests from localhost and GitHub Pages
        const allowedOrigins = [
            'https://axe-08.github.io',
            'http://localhost:8080',
            'http://localhost:8081',
            undefined // Allow requests with no origin (like mobile apps or curl)
        ];
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));

// Add this at the top of your routes
app.get('/test', (req, res) => {
    console.log('Test route hit at:', new Date().toISOString());
    res.json({ 
        status: 'ok',
        message: 'Server is running',
        time: new Date().toISOString()
    });
});

// Also add some logging middleware to see all incoming requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString(),
        headers: req.headers
    });
});

// Initialize Socket.IO with CORS settings
const io = new Server(httpServer, {
    cors: {
        origin: [
            'https://axe-08.github.io',
            'http://localhost:8080',
            'http://localhost:8081'
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

function getLocalIPAddress(): string {
    const nets = networkInterfaces();

    // We need to check if nets[name] exists before using it
    for (const name of Object.keys(nets)) {
        const interfaces = nets[name];

        // Type guard to ensure interfaces is defined
        if (interfaces) {
            // Now TypeScript knows this is an array of NetworkInterfaceInfo
            for (const net of interfaces) {
                // Check for IPv4 and non-internal addresses
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
    }
    return 'localhost'; // Fallback if no suitable address is found
}


const socketHouses = new Map<string, number>();

// Track connected clients
const connectedClients: Map<string, ConnectedClient> = new Map();

// Clean up stale connections every 5 minutes
setInterval(() => {
    const now = new Date();
    for (const [socketId, client] of connectedClients.entries()) {
        if (now.getTime() - client.lastActivity.getTime() > 30 * 60 * 1000) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
                socket.disconnect(true);
            }
            connectedClients.delete(socketId);
            console.log(`Removed stale connection: ${socketId}`);
        }
    }
}, 5 * 60 * 1000);

setInterval(() => {
    io.emit('heartbeat', { timestamp: Date.now() });
}, 30000);

// WebSocket connection handler
io.on('connection', (socket) => {
    debugLog(`New client connecting (ID: ${socket.id})`);

    socket.on('authenticate', (accessCode: string) => {
        db.get(
            "SELECT id, name FROM production_houses WHERE access_code = ?",
            [accessCode],
            (err, house: ProductionHouseWithBudget | undefined) => {
                if (err || !house) {
                    socket.emit('auth_error', 'Invalid access code');
                    return;
                }

                // Store house ID for this socket
                socketHouses.set(socket.id, house.id);

                // Count connections for this house
                const houseConnections = Array.from(socketHouses.values())
                    .filter(id => id === house.id).length;

                debugLog(`Production House ${house.name} has ${houseConnections} active connections`);

                socket.emit('auth_success', {
                    houseId: house.id,
                    houseName: house.name,
                    activeConnections: houseConnections
                });
            }
        );
    });

    socket.on('disconnect', () => {
        const houseId = socketHouses.get(socket.id);
        socketHouses.delete(socket.id);

        if (houseId) {
            const houseConnections = Array.from(socketHouses.values())
                .filter(id => id === houseId).length;
            debugLog(`Production House ${houseId} now has ${houseConnections} active connections`);
        }
        debugLog(`Client disconnected (ID: ${socket.id})`);
        debugLog(`Total connections: ${socketHouses.size}`);
    });



    socket.on('budget_update', (houseId) => {
        // Get fresh budget data from database
        db.get(
            "SELECT id, name, budget FROM production_houses WHERE id = ?",
            [houseId],
            (err, house: ProductionHouseWithBudget | undefined) => {
                if (err || !house) return;
                // Broadcast to all clients
                io.emit('house_budget_updated', {
                    houseId: house.id,
                    budget: house.budget
                });
            }
        );
    });

    socket.on('bid_update', (data: { crewId: number; newBid: number }) => {
        const { crewId, newBid } = data;
        // Update the crew member's current bid in the database
        db.run(
            "UPDATE crew_members SET current_bid = ? WHERE id = ? AND status != 'sold'",
            [newBid, crewId],
            function (err) {
                if (err) {
                    console.error('Error updating bid:', err);
                    return;
                }
                // Broadcast the bid update to all connected clients
                io.emit('bid_updated', { crewId, newBid });
            }
        );
    });
});

// API Routes
app.get('/api/crew', (req, res) => {
    db.all(`
        SELECT 
            c.*,
            ph.name as buyer_name,
            ph.id as production_house_id
        FROM crew_members c
        LEFT JOIN purchased_crew pc ON c.id = pc.crew_member_id
        LEFT JOIN production_houses ph ON pc.production_house_id = ph.id
    `, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/crew/:id', (req, res) => {
    db.get(
        "SELECT * FROM crew_members WHERE id = ?",
        [req.params.id],
        (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (!row) {
                res.status(404).json({ error: "Crew member not found" });
                return;
            }
            res.json(row);
        }
    );
});


app.post('/api/admin/auth', (req: express.Request, res: express.Response) => {
    const { accessCode } = req.body as AdminAuthRequest;

    // For testing, let's log the incoming request
    console.log('Admin auth attempt:', { accessCode });

    // Check for valid admin code
    if (accessCode === 'ADMIN_MASTER_123') {
        // Generate a simple token for now
        const token = Buffer.from(`ADMIN_${Date.now()}`).toString('base64');
        console.log('Admin auth successful');
        res.json({
            success: true,
            token
        });
    } else {
        console.log('Admin auth failed');
        res.status(401).json({
            success: false,
            error: 'Invalid admin code'
        });
    }
});

// Add this with your other endpoints
app.get('/api/admin/verify', (req: express.Request, res: express.Response) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            success: false,
            error: 'No token provided'
        });
        return;
    }

    const encodedToken = authHeader.split(' ')[1];

    try {
        // Decode the Base64 token back to its original form
        const decodedToken = Buffer.from(encodedToken, 'base64').toString();
        console.log('Decoded token:', decodedToken);  // This will show the original ADMIN_timestamp format

        // Now check the decoded token
        if (decodedToken.startsWith('ADMIN_')) {
            res.json({ success: true });
        } else {
            res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }
    } catch (error) {
        console.error('Token decoding error:', error);
        res.status(401).json({
            success: false,
            error: 'Invalid token format'
        });
    }
});

app.post('/api/auth', (req, res) => {
    const { accessCode } = req.body;
    db.get(
        "SELECT id, name, budget FROM production_houses WHERE access_code = ?",
        [accessCode],
        (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (!row) {
                res.status(401).json({ error: "Invalid access code" });
                return;
            }
            res.json(row);
        }
    );
});

app.get('/api/production-house/:id', (req, res) => {
    const productionHouseId = req.params.id;
    db.get(
        "SELECT id, name, budget FROM production_houses WHERE id = ?",
        [productionHouseId],
        (err, productionHouse) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (!productionHouse) {
                res.status(404).json({ error: "Production house not found" });
                return;
            }

            db.all(
                `SELECT cm.*, pc.purchase_price 
                 FROM crew_members cm
                 JOIN purchased_crew pc ON cm.id = pc.crew_member_id
                 WHERE pc.production_house_id = ?`,
                [productionHouseId],
                (err, purchasedCrew) => {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    res.json({
                        ...productionHouse,
                        purchased_crew: purchasedCrew
                    });
                }
            );
        }
    );
});

function processSaleTransaction(
    crewMemberId: number,
    productionHouseId: number,
    purchasePrice: number
): Promise<SaleResult> {
    return new Promise((resolve) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            db.get(
                "SELECT budget FROM production_houses WHERE id = ?",
                [productionHouseId],
                (err, house: ProductionHouseWithBudget | undefined) => {
                    if (err || !house || house.budget < purchasePrice) {
                        db.run("ROLLBACK");
                        resolve({
                            success: false,
                            error: err ? err.message : (!house ? "House not found" : "Insufficient budget")
                        });
                        return;
                    }

                    db.run(
                        "UPDATE crew_members SET status = 'sold' WHERE id = ? AND status != 'sold'",
                        [crewMemberId],
                        function (err) {
                            if (err || this.changes === 0) {
                                db.run("ROLLBACK");
                                resolve({ success: false, error: "Crew member unavailable" });
                                return;
                            }

                            db.run(
                                "UPDATE production_houses SET budget = budget - ? WHERE id = ?",
                                [purchasePrice, productionHouseId],
                                function (err) {
                                    if (err || this.changes === 0) {
                                        db.run("ROLLBACK");
                                        resolve({ success: false, error: "Budget update failed" });
                                        return;
                                    }

                                    db.run(
                                        "INSERT INTO purchased_crew (production_house_id, crew_member_id, purchase_price) VALUES (?, ?, ?)",
                                        [productionHouseId, crewMemberId, purchasePrice],
                                        function (err) {
                                            if (err) {
                                                db.run("ROLLBACK");
                                                resolve({ success: false, error: "Failed to record purchase" });
                                                return;
                                            }

                                            db.run("COMMIT", (err) => {
                                                if (err) {
                                                    db.run("ROLLBACK");
                                                    resolve({ success: false, error: "Transaction failed" });
                                                    return;
                                                }

                                                resolve({
                                                    success: true,
                                                    data: { crewMemberId, productionHouseId, purchasePrice }
                                                });
                                            });
                                        }
                                    );
                                }
                            );
                        }
                    );
                }
            );
        });
    });
}

app.post('/api/sell', (req: express.Request, res: express.Response) => {
    const { crewMemberId, productionHouseId, purchasePrice } = req.body;

    db.serialize(() => {
        // Begin transaction to ensure all operations are atomic
        db.run("BEGIN TRANSACTION");

        // First, let's verify the crew member is available and the house has sufficient budget
        db.get(
            "SELECT budget FROM production_houses WHERE id = ?",
            [productionHouseId],
            (err, house: ProductionHouseWithBudget | undefined) => {
                if (err || !house || house.budget < purchasePrice) {
                    db.run("ROLLBACK");
                    res.status(400).json({
                        success: false,
                        error: err ? err.message : "Insufficient funds or house not found"
                    });
                    return;
                }

                // Update the crew member's status
                db.run(
                    "UPDATE crew_members SET status = 'sold' WHERE id = ? AND status != 'sold'",
                    [crewMemberId],
                    function (err) {
                        if (err || this.changes === 0) {
                            db.run("ROLLBACK");
                            res.status(400).json({
                                success: false,
                                error: "Crew member unavailable"
                            });
                            return;
                        }

                        // Update the production house's budget
                        db.run(
                            "UPDATE production_houses SET budget = budget - ? WHERE id = ?",
                            [purchasePrice, productionHouseId],
                            function (err) {
                                if (err || this.changes === 0) {
                                    db.run("ROLLBACK");
                                    res.status(500).json({
                                        success: false,
                                        error: "Failed to update budget"
                                    });
                                    return;
                                }

                                // Record the purchase
                                db.run(
                                    "INSERT INTO purchased_crew (production_house_id, crew_member_id, purchase_price) VALUES (?, ?, ?)",
                                    [productionHouseId, crewMemberId, purchasePrice],
                                    function (err) {
                                        if (err) {
                                            db.run("ROLLBACK");
                                            res.status(500).json({
                                                success: false,
                                                error: "Failed to record purchase"
                                            });
                                            return;
                                        }

                                        // If everything succeeded, commit the transaction
                                        db.run("COMMIT", (err) => {
                                            if (err) {
                                                db.run("ROLLBACK");
                                                res.status(500).json({
                                                    success: false,
                                                    error: "Transaction failed"
                                                });
                                                return;
                                            }

                                            // Send success response and broadcast the update
                                            res.json({ success: true });
                                            io.emit('sale_complete', {
                                                crewMemberId,
                                                productionHouseId,
                                                purchasePrice
                                            });
                                            io.emit('house_budget_updated', {
                                                houseId: productionHouseId,
                                                purchasePrice
                                            });
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});


app.get('/api/leaderboard', (req, res) => {
    db.all(
        `SELECT 
    ph.id,
    ph.name,
    ph.budget,
    COUNT(DISTINCT pc.crew_member_id) as crew_count,
    COUNT(DISTINCT CASE WHEN cm.category = 'Lead Actor' THEN cm.id END) as lead_actors,
    COUNT(DISTINCT CASE WHEN cm.category = 'Supporting Actor' THEN cm.id END) as supporting_actors,
    COUNT(DISTINCT CASE WHEN cm.category = 'Musician' THEN cm.id END) as musicians,
    COUNT(DISTINCT CASE WHEN cm.category = 'Director' THEN cm.id END) as directors,
    COUNT(DISTINCT CASE WHEN cm.category = 'Nepo Kid' THEN cm.id END) as nepo_kids,
    COUNT(DISTINCT CASE WHEN cm.category = 'Comedic Relief' THEN cm.id END) as comedic_relief,
    AVG(cm.rating) as average_rating
    FROM production_houses ph
    LEFT JOIN purchased_crew pc ON ph.id = pc.production_house_id
    LEFT JOIN crew_members cm ON pc.crew_member_id = cm.id
    GROUP BY ph.id
    ORDER BY average_rating DESC`,
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json(rows);
        }
    );
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

