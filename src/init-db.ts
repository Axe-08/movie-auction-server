import sqlite3 from 'sqlite3';

// Open database connection (creates file if it doesn't exist)
const db = new sqlite3.Database('auction.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
        return;
    }
    console.log('Connected to the auction database.');
});

// Initialize tables
db.serialize(() => {
    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON");

    db.run(`
        CREATE TABLE IF NOT EXISTS admin_auth (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            access_code TEXT UNIQUE NOT NULL
        )
    `);
    
    // Insert admin access code
    db.run("INSERT OR REPLACE INTO admin_auth (id, access_code) VALUES (1, 'ADMIN_MASTER_123')");

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS crew_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            rating INTEGER NOT NULL,
            base_price INTEGER NOT NULL,
            current_bid INTEGER,
            status TEXT DEFAULT 'available'
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS production_houses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            budget INTEGER NOT NULL,
            access_code TEXT UNIQUE NOT NULL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS purchased_crew (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            production_house_id INTEGER,
            crew_member_id INTEGER,
            purchase_price INTEGER NOT NULL,
            FOREIGN KEY(production_house_id) REFERENCES production_houses(id),
            FOREIGN KEY(crew_member_id) REFERENCES crew_members(id)
        )
    `);

    // Insert some test data
    // First, clear existing data
    db.run("DELETE FROM purchased_crew");
    db.run("DELETE FROM crew_members");
    db.run("DELETE FROM production_houses");

    // Insert test crew members
    const crewMembers = [
        ['Shah Rukh Khan', 'Lead Actor', 95, 30000000],
        ['Deepika Padukone', 'Lead Actor', 90, 25000000],
        ['Nawazuddin Siddiqui', 'Supporting Actor', 88, 15000000],
        ['AR Rahman', 'Musician', 96, 20000000],
        ['Rohit Shetty', 'Director', 85, 20000000],
        ['Ibrahim Khan', 'Nepo Kid', 70, 5000000],
        ['Johnny Lever', 'Comedic Relief', 85, 10000000]
    ];

    const insertCrew = db.prepare(`
        INSERT INTO crew_members (
            name, category, rating, base_price, current_bid
        ) VALUES (?, ?, ?, ?, ?)`
    );

    crewMembers.forEach(member => {
        insertCrew.run([
            member[0],           // name
            member[1],           // category
            member[2],           // rating
            member[3],           // base_price
            member[3]            // current_bid starts equal to base_price
        ]);
    });
    insertCrew.finalize();

    // Insert test production houses
    const productionHouses = [
        ['Red Chillies', 1000000000, 'RED001'],
        ['Dharma Productions', 1000000000, 'DHA001'],
        ['Yash Raj Films', 1000000000, 'YRF001']
    ];

    const insertHouse = db.prepare("INSERT INTO production_houses (name, budget, access_code) VALUES (?, ?, ?)");
    productionHouses.forEach(house => {
        insertHouse.run(house, (err) => {
            if (err) console.error('Error inserting production house:', err);
        });
    });
    insertHouse.finalize();

    console.log('Database initialized with test data!');
});

// Close the database connection
db.close((err) => {
    if (err) {
        console.error('Error closing database:', err);
        return;
    }
    console.log('Database connection closed.');
});