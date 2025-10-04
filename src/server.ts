const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

// Types
interface RegistrationRecord {
  id?: number;
  ethAddress: string;
  rgbAddress: string;
  signature: string;
  message: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RegistrationRequest {
  ethAddress: string;
  rgbAddress: string;
  signature: string;
  message: string;
}

// Database setup
class DatabaseManager {
  private db: any;
  private static instance: DatabaseManager;

  constructor() {
    const dbPath = process.env.NODE_ENV === 'production' 
      ? '/tmp/registrations.db'  // AWS deployment
      : path.join(__dirname, '../data/registrations.db');

    // Create data directory if it doesn't exist (for local development)
    if (process.env.NODE_ENV !== 'production') {
      const fs = require('fs');
      const dataDir = path.dirname(dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    }

    this.db = new Database(dbPath);
    this.initializeSchema();
    console.log(`📁 Database initialized at: ${dbPath}`);
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private initializeSchema() {
    const createTable = `
      CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eth_address TEXT NOT NULL,
        rgb_address TEXT NOT NULL,
        signature TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(eth_address, rgb_address)
      )
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_eth_address ON registrations(eth_address);
      CREATE INDEX IF NOT EXISTS idx_rgb_address ON registrations(rgb_address);
      CREATE INDEX IF NOT EXISTS idx_created_at ON registrations(created_at);
    `;

    this.db.exec(createTable);
    this.db.exec(createIndexes);

    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 1000');
  }

  insertRegistration(data: Omit<RegistrationRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    const stmt = this.db.prepare(`
      INSERT INTO registrations (eth_address, rgb_address, signature, message)
      VALUES (?, ?, ?, ?)
    `);
    
    try {
      const result = stmt.run(data.ethAddress, data.rgbAddress, data.signature, data.message);
      return {
        success: true,
        id: result.lastInsertRowid,
        message: 'Registration saved successfully'
      };
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return {
          success: false,
          error: 'Registration already exists for this address combination'
        };
      }
      throw error;
    }
  }

  // Fetch all registrations
  getAllRegistrations() {
    return this.db.prepare('SELECT * FROM registrations').all();
  }



  close() {
    this.db.close();
  }
}

// Express app setup
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
const db = DatabaseManager.getInstance();

// Routes
// Health check endpoint
app.get('/ping', (_req: any, res: any) => {
  res.status(200).send('Pong!');
});

// Testing endpoint: Get all registrations
app.get('/registrations', (_req: any, res: any) => {
  try {
    const rows = db.getAllRegistrations();
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching registrations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch registrations' });
  }
});

app.post('/submit', (req: any, res: any) => {
  try {
    const { ethAddress, rgbAddress, signature, message }: RegistrationRequest = req.body;

    // Log the received data for debugging
    console.log('Registration request received:', {
      ethAddress,
      rgbAddress,
      signature: signature ? `${signature.slice(0, 10)}...` : 'none',
      messageLength: message?.length || 0
    });

    // Validate required fields
    if (!ethAddress || !rgbAddress || !signature || !message) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Validate address format (works for all EVM chains)
    if (!/^0x[a-fA-F0-9]{40}$/.test(ethAddress)) {
      return res.status(400).json({
        error: 'Invalid ETH address format'
      });
    }

    // Validate RGB address (basic check - should start with bc1 for taproot)
    if (!rgbAddress.startsWith('bc1')) {
      return res.status(400).json({
        error: 'Invalid RGB address format - must be a Taproot address starting with bc1'
      });
    }

    // Simulate signature verification (in real implementation, you'd verify the signature)
    // For testing purposes, we'll accept any signature that's hex-like and long enough
    if (signature.length < 100) {
      return res.status(401).json({
        error: 'Signature verification failed'
      });
    }

    // Insert into database
    const result = db.insertRegistration({
      ethAddress,
      rgbAddress,
      signature,
      message
    });

    if (!result.success) {
      return res.status(500).json({
        error: result.error || 'Failed to save registration'
      });
    }

    console.log(`✅ Registration saved with ID: ${result.id}`);

    res.status(200).json({
      success: true,
      message: 'Registration successful',
      ethAddress,
      rgbAddress,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Registration API error:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});



// Start server

app.listen(PORT, () => {
  const origin = process.env.ORIGIN || `http://localhost:${PORT}`;
  console.log(`🚀 Database server running on port ${PORT}`);
  console.log(` API endpoint: POST ${origin}/submit`);
  console.log(` Health check: GET ${origin}/ping`);
});

// Self-ping every 10 minutes to keep the process alive on Render
if (process.env.ORIGIN) {
  setInterval(
    () => {
      fetch(process.env.ORIGIN + '/ping')
        .then(() => console.log('Self-ping successful'))
        .catch((error) => console.error('Self-ping failed:', error.message));
    },
    10 * 60 * 1000 // 10 minutes
  );
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down server...');
  db.close();
  process.exit(0);
});